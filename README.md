# prioritizarr

Automatically keep your chosen torrents — **private**, **public**, or **tracker-matched** —
at the **top of the qBittorrent download queue**. A tiny, zero-dependency companion for
the *arr stack (or any qBittorrent setup).

## Why

qBittorrent has no built-in rule to auto-prioritise torrents by tracker or privacy.
prioritizarr polls qBittorrent on a schedule, decides which torrents matter to you, and
bumps them to the top of the queue via the `torrents/topPrio` API.

Common uses:
- **Private-tracker users:** grab private torrents first (better speeds; protects ratio).
- **Public-tracker users:** grab public torrents first before their swarms die, while
  well-seeded private ones can wait.
- **Anyone:** always prioritise a specific set of favourite trackers.

## How it decides what's "priority"

For each **active/queued** torrent (queue position > 0), in scope of your category
filters, prioritizarr checks in this order:

1. **Exclusions** — if a tracker matches `EXCLUDE_TRACKERS`, it's never prioritised.
2. **Tracker allowlist** — if a tracker matches `PRIORITY_TRACKERS`, it's prioritised
   (this is **always additive**, regardless of mode).
3. **Mode** (`PRIORITIZE_MODE`):
   - `private` — torrents qBittorrent reports as private (`is_private`, needs qBit 5.0+)
   - `public` — torrents reported as **not** private
   - `trackers` — only the allowlist applies (no privacy check)
   - `none` — same as `trackers`; rely solely on the allowlist

Then, if the priority torrents aren't already at the top of the queue, they're bumped.

## Requirements

- **qBittorrent "Torrent Queueing" must be ENABLED** (Options → BitTorrent), or queue
  priority does nothing. prioritizarr warns in the logs if it's disabled.
- **`private`/`public` modes need qBittorrent 5.0+** (for the `is_private` flag). On older
  builds, use `PRIORITY_TRACKERS` instead — prioritizarr warns once if `is_private` is
  unavailable.
- Network access to qBittorrent. If your subnet (including the Docker bridge range, e.g.
  `172.16.0.0/12`) is whitelisted in qBittorrent's "bypass authentication" option, no
  credentials are needed. Otherwise set `QBIT_USERNAME` / `QBIT_PASSWORD`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `QBIT_URL` | `http://qbittorrent:8080` | qBittorrent Web UI base URL |
| `QBIT_USERNAME` | – | Only if not using the subnet whitelist |
| `QBIT_PASSWORD` | – | Only if not using the subnet whitelist |
| `QBIT_VERIFY_TLS` | `true` | Set `false` for self-signed HTTPS qBittorrent |
| `INTERVAL_SECONDS` | `60` | How often to check (min 15) |
| `RUN_ONCE` | `false` | Run one cycle then exit (for external cron) |
| `DRY_RUN` | `true` | Log only; reorder nothing. Set `false` to act |
| `PRIORITIZE_MODE` | `private` | `private` \| `public` \| `trackers` \| `none` |
| `PRIORITY_TRACKERS` | – | Comma-separated tracker substrings to always prioritise |
| `EXCLUDE_TRACKERS` | – | Comma-separated tracker substrings to never prioritise |
| `CATEGORIES` | – | Only act on these qBittorrent categories (empty = all) |
| `EXCLUDE_CATEGORIES` | – | Never act on these categories |
| `ONLY_DOWNLOADING` | `false` | Only consider actively-downloading torrents |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

Tracker matching is a case-insensitive **substring** match against each torrent's tracker
URLs (e.g. `beyondhd.me` matches `https://beyondhd.me/announce`).

## docker-compose

```yaml
  prioritizarr:
    build: /volume1/docker/prioritizarr-src   # or image: <registry>/prioritizarr
    container_name: prioritizarr
    environment:
      - TZ=Europe/Paris
      - QBIT_URL=http://qbittorrent:8080
      - INTERVAL_SECONDS=60
      - DRY_RUN=true                 # verify first, then set false
      - PRIORITIZE_MODE=private      # private | public | trackers | none
      # Optional:
      # - PRIORITY_TRACKERS=beyondhd.me,passthepopcorn.me
      # - EXCLUDE_TRACKERS=some-tracker.example
      # - CATEGORIES=radarr,sonarr
      # - QBIT_USERNAME=admin
      # - QBIT_PASSWORD=changeme
    dns:
      - 1.1.1.1
      - 8.8.8.8
    restart: unless-stopped
```

> No volume needed — prioritizarr is stateless.

## Run locally (no Docker)

```bash
QBIT_URL=http://localhost:8080 \
PRIORITIZE_MODE=private \
DRY_RUN=true \
node src/index.js
```

## Notes

- **Idempotent:** re-topping torrents already on top keeps them there; the tool skips work
  when priority torrents already occupy the top queue positions.
- **Stateless:** safe to restart anytime.
- **Safe by default:** `DRY_RUN=true` out of the box — inspect the logs, then set it false.

## License

MIT.
