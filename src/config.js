// Configuration from environment variables.
//
// The only value most users need to set is QBIT_URL (and credentials if their
// subnet isn't whitelisted). Everything else has a sensible default.

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function num(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Which class of torrents to prioritise.
//   private  -> torrents qBittorrent reports as private (is_private, qBit 5.0+)
//   public   -> torrents reported as NOT private
//   trackers -> only match against PRIORITY_TRACKERS
//   none     -> ignore the private/public flag; rely solely on PRIORITY_TRACKERS
// PRIORITY_TRACKERS is ALWAYS additive: a matching tracker is prioritised
// regardless of mode (unless it also matches EXCLUDE_TRACKERS).
const VALID_MODES = new Set(['private', 'public', 'trackers', 'none']);
function mode(value) {
  const v = String(value || 'private').trim().toLowerCase();
  return VALID_MODES.has(v) ? v : 'private';
}

const logLevelRaw = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();

const config = {
  // --- Connection ---
  qbitUrl: (process.env.QBIT_URL || 'http://qbittorrent:8080').replace(/\/+$/, ''),
  qbitUsername: process.env.QBIT_USERNAME || '',
  qbitPassword: process.env.QBIT_PASSWORD || '',
  // Verify TLS certificates (set false for self-signed HTTPS qBittorrent).
  verifyTls: bool(process.env.QBIT_VERIFY_TLS, true),

  // --- Scheduling / execution ---
  intervalSeconds: Math.max(15, num(process.env.INTERVAL_SECONDS, 60)),
  // Run a single cycle then exit (for users who prefer external cron).
  runOnce: bool(process.env.RUN_ONCE, false),

  // --- Safety ---
  dryRun: bool(process.env.DRY_RUN, true),

  // --- What to prioritise ---
  // Strategy selector (private | public | trackers | none). Default: private.
  prioritizeMode: mode(process.env.PRIORITIZE_MODE),

  // Comma-separated substrings matched against tracker URLs. Always additive:
  // matching torrents are prioritised on top of whatever PRIORITIZE_MODE selects.
  priorityTrackers: list(process.env.PRIORITY_TRACKERS),

  // Comma-separated substrings; a torrent matching any of these is NEVER
  // prioritised, even if it would otherwise qualify. Takes precedence.
  excludeTrackers: list(process.env.EXCLUDE_TRACKERS),

  // --- Scope filters (qBittorrent categories) ---
  // Only consider torrents in these categories (empty = all categories).
  categories: list(process.env.CATEGORIES),
  // Never consider torrents in these categories.
  excludeCategories: list(process.env.EXCLUDE_CATEGORIES),

  // Only consider torrents currently downloading (vs any queued/stalled item).
  onlyDownloading: bool(process.env.ONLY_DOWNLOADING, false),

  // --- Logging ---
  logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevelRaw)
    ? logLevelRaw
    : 'info',
};

export default config;
