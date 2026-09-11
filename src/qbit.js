// Minimal qBittorrent Web API v2 client.
// Handles optional cookie-based login, listing torrents (with is_private when
// available), reading trackers, and moving torrents to the top of the queue.

export class QBittorrent {
  constructor(baseUrl, username, password, { verifyTls = true } = {}) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.cookie = null;
    this.verifyTls = verifyTls;
    this.dispatcher = undefined; // set up lazily in init()
  }

  // Prepare a TLS-relaxed dispatcher for self-signed HTTPS instances.
  // Called once before use. Uses undici, which ships with Node 18+.
  async init() {
    if (this.verifyTls || !this.baseUrl.startsWith('https')) return;
    try {
      const { Agent } = await import('undici');
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch {
      // undici not importable in this runtime; requests will use defaults.
    }
  }

  async #call(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const opts = { method, headers, body };
    if (this.dispatcher) opts.dispatcher = this.dispatcher;
    const res = await fetch(`${this.baseUrl}${path}`, opts);
    return res;
  }

  // Log in only if credentials were provided. When the subnet is whitelisted in
  // qBittorrent, no login is needed and API calls succeed without a cookie.
  async login() {
    if (!this.username && !this.password) return; // rely on whitelist
    const body = new URLSearchParams({
      username: this.username,
      password: this.password,
    }).toString();
    const res = await this.#call('/api/v2/auth/login', { method: 'POST', body });
    const text = await res.text();
    if (!res.ok || text.trim() !== 'Ok.') {
      throw new Error(`qBittorrent login failed (HTTP ${res.status}: ${text.trim()})`);
    }
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
  }

  // Full torrent list. Each entry may include `is_private` (qBittorrent 5.0+),
  // `hash`, `name`, `priority` (queue position), `state`.
  async listTorrents() {
    const res = await this.#call('/api/v2/torrents/info');
    if (!res.ok) throw new Error(`torrents/info -> HTTP ${res.status}`);
    return res.json();
  }

  // Trackers for a given torrent hash. Used as a fallback when is_private is
  // unavailable, or to match against a manual PRIORITY_TRACKERS list.
  async getTrackers(hash) {
    const res = await this.#call(`/api/v2/torrents/trackers?hash=${encodeURIComponent(hash)}`);
    if (!res.ok) throw new Error(`torrents/trackers -> HTTP ${res.status}`);
    return res.json(); // array of { url, status, ... }
  }

  // Move the given hashes to the top of the queue. Requires queueing enabled.
  async topPriority(hashes) {
    if (!hashes.length) return;
    const body = new URLSearchParams({ hashes: hashes.join('|') }).toString();
    const res = await this.#call('/api/v2/torrents/topPrio', { method: 'POST', body });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`torrents/topPrio -> HTTP ${res.status} ${text}`.trim());
    }
  }

  // Whether queueing (and thus queue priority) is enabled in qBittorrent.
  async isQueueingEnabled() {
    const res = await this.#call('/api/v2/app/preferences');
    if (!res.ok) return null; // unknown
    const prefs = await res.json();
    return Boolean(prefs.queueing_enabled);
  }
}
