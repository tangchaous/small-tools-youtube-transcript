import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObsidianClient, ObsidianError, notePath, normalizeFolder, sharedEndpoints } from '../lib/obsidian.js';

// Fake fetch backed by an in-memory vault: { 'Inbox/a.md': '...' }.
function fakeVault(files = {}, { apiKey = 'k' } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ method: opts.method ?? 'GET', path: u.pathname, headers: opts.headers ?? {}, body: opts.body });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.pathname === '/') return json(200, { status: 'OK', authenticated: opts.headers?.Authorization === `Bearer ${apiKey}` });
    if (opts.headers?.Authorization !== `Bearer ${apiKey}`) return json(401, { errorCode: 40101, message: 'Authorization required.' });
    const path = decodeURIComponent(u.pathname.replace(/^\/vault\/?/, ''));
    if (path === '' || path.endsWith('/')) {
      const prefix = path;
      const entries = new Set();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        entries.add(rest.includes('/') ? rest.split('/')[0] + '/' : rest);
      }
      if (!entries.size && prefix) return json(404, { errorCode: 40400, message: 'Not Found' });
      return json(200, { files: [...entries] });
    }
    if ((opts.method ?? 'GET') === 'GET') return path in files ? json(200, files[path]) : json(404, { message: 'Not Found' });
    if (opts.method === 'PUT') { files[path] = opts.body; return { ok: true, status: 204, json: async () => ({}), text: async () => '' }; }
    return json(405, {});
  };
  return { fetch, calls, files };
}

test('normalizeFolder trims slashes and whitespace', () => {
  assert.equal(normalizeFolder(' /Inbox//YouTube/ '), 'Inbox/YouTube');
  assert.equal(normalizeFolder(''), '');
  assert.equal(normalizeFolder('/'), '');
});

test('notePath joins folder and file, encoding each segment', () => {
  assert.equal(notePath('/Inbox/You Tube/', 'A #b.md'), 'Inbox/You%20Tube/A%20%23b.md');
  assert.equal(notePath('', 'x.md'), 'x.md');
});

test('putNote writes to the folder with auth and markdown content type', async () => {
  const v = fakeVault();
  const client = new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123/', apiKey: 'k', fetch: v.fetch });
  const path = await client.putNote('/Inbox/YouTube/', 'Video', '# hi');
  assert.equal(path, 'Inbox/YouTube/Video.md');
  assert.equal(v.files['Inbox/YouTube/Video.md'], '# hi');
  const put = v.calls.find((c) => c.method === 'PUT');
  assert.equal(put.headers['Content-Type'], 'text/markdown');
  assert.equal(put.path, '/vault/Inbox/YouTube/Video.md');
});

test('putNote never overwrites: dedupes to (2), (3)', async () => {
  const v = fakeVault({ 'Inbox/Video.md': 'old', 'Inbox/Video (2).md': 'old2' });
  const client = new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123', apiKey: 'k', fetch: v.fetch });
  assert.equal(await client.putNote('Inbox', 'Video', 'new'), 'Inbox/Video (3).md');
  assert.equal(v.files['Inbox/Video.md'], 'old');
});

test('putNote at vault root when folder is empty', async () => {
  const v = fakeVault();
  const client = new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123', apiKey: 'k', fetch: v.fetch });
  assert.equal(await client.putNote('', 'Video', 'x'), 'Video.md');
});

test('401 becomes a user-facing ObsidianError', async () => {
  const v = fakeVault();
  const client = new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123', apiKey: 'wrong', fetch: v.fetch });
  await assert.rejects(client.putNote('Inbox', 'Video', 'x'), (e) => e instanceof ObsidianError && /API key/.test(e.message));
});

test('network failure explains Obsidian is not reachable', async () => {
  const client = new ObsidianClient({
    baseUrl: 'http://127.0.0.1:27123', apiKey: 'k',
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  });
  await assert.rejects(client.ping(), (e) => e instanceof ObsidianError && /not reachable at http:\/\/127\.0\.0\.1:27123/.test(e.message));
});

test('ping reports authentication state', async () => {
  const v = fakeVault();
  const ok = await new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123', apiKey: 'k', fetch: v.fetch }).ping();
  const bad = await new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123', apiKey: 'x', fetch: v.fetch }).ping();
  assert.deepEqual([ok.authenticated, bad.authenticated], [true, false]);
});

test('listFolders recurses to the given depth and returns sorted folder paths', async () => {
  const v = fakeVault({
    'Inbox/YouTube/a.md': '', 'Inbox/b.md': '', 'Projects/X/Deep/c.md': '', 'root.md': '',
  });
  const client = new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123', apiKey: 'k', fetch: v.fetch });
  assert.deepEqual(await client.listFolders(2), ['Inbox', 'Inbox/YouTube', 'Projects', 'Projects/X']);
});

test('401 message points at the shared-port cause', async () => {
  const v = fakeVault();
  const client = new ObsidianClient({ baseUrl: 'http://127.0.0.1:27123', apiKey: 'wrong', fetch: v.fetch });
  await assert.rejects(client.putNote('Inbox', 'Video', 'x'), (e) => /same port/.test(e.message));
});

test('sharedEndpoints groups vault profiles that point at the same host:port', () => {
  assert.deepEqual(
    sharedEndpoints([
      { name: 'A', baseUrl: 'http://127.0.0.1:27123' },
      { name: 'B', baseUrl: 'http://127.0.0.1:27123/' },
      { name: 'C', baseUrl: 'http://127.0.0.1:27125' },
      { name: 'D', baseUrl: 'http://localhost:27123' },
    ]),
    [['A', 'B', 'D']]
  );
});

test('sharedEndpoints ignores unparseable URLs', () => {
  assert.deepEqual(sharedEndpoints([{ name: 'A', baseUrl: 'nope' }, { name: 'B', baseUrl: 'nope' }]), []);
});
