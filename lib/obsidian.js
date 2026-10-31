// Client for the Obsidian "Local REST API" community plugin.
// https://github.com/coddingtonbear/obsidian-local-rest-api

export class ObsidianError extends Error {}

export function normalizeFolder(folder) {
  return String(folder ?? '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Groups of vault names whose profiles point at the same server. Only one Obsidian vault can listen
// on a port, so profiles in one group can't all be reached while those vaults are open together.
export function sharedEndpoints(vaults) {
  const groups = new Map();
  for (const { name, baseUrl } of vaults) {
    let key;
    try {
      const u = new URL(baseUrl);
      const host = LOOPBACK.has(u.hostname) ? 'loopback' : u.hostname;
      key = `${host}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
    } catch {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  return [...groups.values()].filter((names) => names.length > 1);
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

export function notePath(folder, filename) {
  const f = normalizeFolder(folder);
  return encodePath(f ? `${f}/${filename}` : filename);
}

export class ObsidianClient {
  constructor({ baseUrl, apiKey, fetch = globalThis.fetch.bind(globalThis) }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.fetch = fetch;
  }

  async request(path, { method = 'GET', body, headers = {} } = {}) {
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/${path}`, {
        method,
        body,
        headers: { Authorization: `Bearer ${this.apiKey}`, ...headers },
      });
    } catch {
      throw new ObsidianError(
        `Obsidian not reachable at ${this.baseUrl}. Is Obsidian open with the Local REST API plugin enabled ` +
        '(and, for http://, "Enable Non-encrypted (HTTP) Server" turned on)?'
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ObsidianError(
        `Obsidian at ${this.baseUrl} rejected the API key. If several vaults have Local REST API on the same port, ` +
        'only the first vault opened is listening there: give each vault its own port in Settings → Local REST API. ' +
        'Otherwise, copy the key again from that page.'
      );
    }
    return res;
  }

  async ping() {
    const res = await this.request('');
    const body = await res.json();
    return { ok: res.ok, authenticated: Boolean(body.authenticated) };
  }

  async exists(path) {
    const res = await this.request(`vault/${path}`);
    if (res.status === 404) return false;
    if (!res.ok) throw new ObsidianError(`Obsidian returned HTTP ${res.status} checking ${decodeURIComponent(path)}.`);
    return true;
  }

  async listFolders(depth = 2) {
    const out = [];
    const walk = async (prefix, level) => {
      const res = await this.request(`vault/${prefix ? `${encodePath(prefix)}/` : ''}`);
      if (!res.ok) return;
      const { files = [] } = await res.json();
      const dirs = files.filter((f) => f.endsWith('/')).map((f) => (prefix ? `${prefix}/` : '') + f.slice(0, -1));
      for (const dir of dirs) {
        if (dir.split('/').some((s) => s.startsWith('.'))) continue;
        out.push(dir);
        if (level < depth) await walk(dir, level + 1);
      }
    };
    await walk('', 1);
    return out.sort((a, b) => a.localeCompare(b));
  }

  // Writes `${folder}/${baseName}.md`, choosing "baseName (n).md" if it exists.
  // Returns the vault-relative path that was written (unencoded).
  async putNote(folder, baseName, body) {
    let name = `${baseName}.md`;
    for (let n = 2; await this.exists(notePath(folder, name)); n++) name = `${baseName} (${n}).md`;
    const res = await this.request(`vault/${notePath(folder, name)}`, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'text/markdown' },
    });
    if (!res.ok) throw new ObsidianError(`Obsidian returned HTTP ${res.status} saving the note.`);
    const f = normalizeFolder(folder);
    return f ? `${f}/${name}` : name;
  }
}
