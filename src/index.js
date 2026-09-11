// prioritizarr — keep chosen torrents (private, public, or tracker-matched) at
// the top of the qBittorrent download queue.
//
// Each cycle:
//   1. List torrents (torrents/info includes hash, name, priority, category,
//      state, and is_private on qBittorrent 5.0+).
//   2. Filter to the in-scope, active queue (category filters, downloading-only,
//      queue position > 0).
//   3. Flag "priority" torrents based on PRIORITIZE_MODE + PRIORITY_TRACKERS,
//      minus EXCLUDE_TRACKERS.
//   4. If they aren't already at the top, bump them via torrents/topPrio
//      (unless DRY_RUN).

import config from './config.js';
import { QBittorrent } from './qbit.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
function log(level, ...args) {
  if (LEVELS[level] >= LEVELS[config.logLevel]) {
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
  }
}

// A torrent's downloading-ish states (has a meaningful queue position).
const DOWNLOADING_STATES = new Set([
  'downloading',
  'stalledDL',
  'metaDL',
  'queuedDL',
  'checkingDL',
  'forcedDL',
  'allocating',
]);

function inScopeByCategory(t) {
  const cat = String(t.category || '').toLowerCase();
  if (config.excludeCategories.length && config.excludeCategories.includes(cat)) {
    return false;
  }
  if (config.categories.length && !config.categories.includes(cat)) {
    return false;
  }
  return true;
}

// Does any tracker URL match one of the given needles?
async function trackerMatches(qbit, hash, needles) {
  if (needles.length === 0) return false;
  let trackers;
  try {
    trackers = await qbit.getTrackers(hash);
  } catch {
    return false;
  }
  for (const tr of trackers) {
    const url = String(tr.url || '').toLowerCase();
    if (url.startsWith('**')) continue; // DHT/PeX/LSD pseudo-entries
    if (needles.some((n) => url.includes(n))) return true;
  }
  return false;
}

// Decide whether a single torrent should be prioritised.
async function shouldPrioritise(qbit, t, hasIsPrivate) {
  // Exclusions win outright.
  if (await trackerMatches(qbit, t.hash, config.excludeTrackers)) {
    return { yes: false };
  }

  // Always-additive tracker allowlist.
  if (await trackerMatches(qbit, t.hash, config.priorityTrackers)) {
    return { yes: true, reason: 'tracker-list' };
  }

  switch (config.prioritizeMode) {
    case 'private':
      if (hasIsPrivate && t.is_private === true) return { yes: true, reason: 'private' };
      return { yes: false };
    case 'public':
      if (hasIsPrivate && t.is_private === false) return { yes: true, reason: 'public' };
      return { yes: false };
    case 'trackers':
    case 'none':
      // Only the tracker allowlist applies (already checked above).
      return { yes: false };
    default:
      return { yes: false };
  }
}

async function runOnce(qbit, ctx) {
  let torrents;
  try {
    torrents = await qbit.listTorrents();
  } catch (err) {
    log('error', `listing torrents failed: ${err.message}`);
    return;
  }

  const hasIsPrivate = torrents.some((t) => 'is_private' in t);
  if (
    (config.prioritizeMode === 'private' || config.prioritizeMode === 'public') &&
    !hasIsPrivate &&
    !ctx.warnedNoIsPrivate
  ) {
    log(
      'warn',
      `PRIORITIZE_MODE=${config.prioritizeMode} needs the is_private flag ` +
        '(qBittorrent 5.0+), which this instance does not expose. ' +
        'Only PRIORITY_TRACKERS matching will take effect.',
    );
    ctx.warnedNoIsPrivate = true;
  }

  // Scope: category filters + active queue only.
  const active = torrents.filter((t) => {
    if (typeof t.priority !== 'number' || t.priority <= 0) return false;
    if (config.onlyDownloading && !DOWNLOADING_STATES.has(t.state)) return false;
    if (!inScopeByCategory(t)) return false;
    return true;
  });

  log('debug', `Considering ${active.length} in-scope active torrent(s).`);

  const toPrioritise = [];
  for (const t of active) {
    const decision = await shouldPrioritise(qbit, t, hasIsPrivate);
    if (decision.yes) {
      toPrioritise.push({ hash: t.hash, name: t.name, position: t.priority, reason: decision.reason });
    }
  }

  if (toPrioritise.length === 0) {
    log('info', 'No priority torrents currently in the active queue.');
    return;
  }

  // Already occupying the top N positions (1..N)? Then nothing to do.
  const sortedPositions = toPrioritise.map((t) => t.position).sort((a, b) => a - b);
  const alreadyAllTop = sortedPositions.every((pos, i) => pos === i + 1);
  if (alreadyAllTop) {
    log('info', `All ${toPrioritise.length} priority torrent(s) already at top of queue.`);
    return;
  }

  for (const t of toPrioritise) {
    log(
      'info',
      `${config.dryRun ? '[DRY RUN] would bump' : 'BUMPING'} "${t.name}" ` +
        `(queue pos ${t.position}, reason: ${t.reason})`,
    );
  }

  if (!config.dryRun) {
    try {
      await qbit.topPriority(toPrioritise.map((t) => t.hash));
      log('info', `Moved ${toPrioritise.length} priority torrent(s) to top of queue.`);
    } catch (err) {
      log('error', `setting top priority failed: ${err.message}`);
    }
  }
}

async function main() {
  log('info', 'Starting prioritizarr.');
  log(
    'info',
    `Config: qbit=${config.qbitUrl} mode=${config.prioritizeMode} ` +
      `interval=${config.intervalSeconds}s runOnce=${config.runOnce} dryRun=${config.dryRun}`,
  );
  log(
    'debug',
    `priorityTrackers=[${config.priorityTrackers.join(', ')}] ` +
      `excludeTrackers=[${config.excludeTrackers.join(', ')}] ` +
      `categories=[${config.categories.join(', ')}] ` +
      `excludeCategories=[${config.excludeCategories.join(', ')}] ` +
      `onlyDownloading=${config.onlyDownloading} verifyTls=${config.verifyTls}`,
  );
  if (config.dryRun) log('warn', 'DRY RUN enabled — nothing will be reordered.');

  const qbit = new QBittorrent(config.qbitUrl, config.qbitUsername, config.qbitPassword, {
    verifyTls: config.verifyTls,
  });
  await qbit.init();

  try {
    await qbit.login();
    log('info', 'qBittorrent authentication OK (or not required).');
  } catch (err) {
    log('warn', err.message);
  }

  try {
    const queueing = await qbit.isQueueingEnabled();
    if (queueing === false) {
      log(
        'warn',
        'qBittorrent queueing is DISABLED. Queue priority has no effect until you ' +
          'enable "Torrent Queueing" in qBittorrent Options → BitTorrent.',
      );
    }
  } catch {
    /* ignore */
  }

  const ctx = { warnedNoIsPrivate: false };

  await runOnce(qbit, ctx);

  if (config.runOnce) {
    log('info', 'RUN_ONCE set — exiting after one cycle.');
    return;
  }

  setInterval(async () => {
    try {
      await qbit.login();
    } catch {
      /* ignore; whitelist mode */
    }
    await runOnce(qbit, ctx);
  }, config.intervalSeconds * 1000);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
