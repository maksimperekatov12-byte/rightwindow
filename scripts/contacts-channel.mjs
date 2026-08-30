// Private delivery channel for resolved contacts.
//
// The contacts belong in the private Blob store, but while that is suspended
// they have no way to reach CI: the cache is gitignored (a curated database of
// NYC managing-agent contacts is an asset, not something to publish), so every
// hourly run started blank and resolved nothing.
//
// This reads and writes the same cache through a private GitHub repo instead.
// Set CONTACTS_REPO (owner/name) and CONTACTS_TOKEN (a PAT with repo scope).
// Falls back silently when they are absent, so nothing here is load-bearing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CACHE = new URL('../data/enrich-cache.json', import.meta.url);
const FILE = 'contacts-cache.json';
const repo = () => process.env.CONTACTS_REPO;
const token = () => process.env.CONTACTS_TOKEN;

const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo()}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'RightWindow/1.0',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });

export function channelReady() {
  return Boolean(repo() && token());
}

export async function pullContacts() {
  if (!channelReady()) return { pulled: 0, reason: 'CONTACTS_REPO / CONTACTS_TOKEN not set' };
  const r = await api(`contents/${FILE}`);
  if (!r.ok) return { pulled: 0, reason: `channel read failed (${r.status})` };
  const j = await r.json();
  const remote = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  let local = {};
  try {
    if (existsSync(CACHE)) local = JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {}
  let added = 0;
  for (const [k, v] of Object.entries(remote)) {
    if (!local[k] || (v.at || 0) > (local[k].at || 0)) {
      local[k] = v;
      added++;
    }
  }
  writeFileSync(CACHE, JSON.stringify(local, null, 1));
  return { pulled: added, total: Object.keys(local).length, sha: j.sha };
}

export async function pushContacts(sha) {
  if (!channelReady()) return { pushed: 0, reason: 'CONTACTS_REPO / CONTACTS_TOKEN not set' };
  if (!existsSync(CACHE)) return { pushed: 0, reason: 'no local cache' };
  const body = readFileSync(CACHE, 'utf8');
  // The API refuses to overwrite without the current sha, so read it first.
  let head = sha;
  if (!head) {
    const cur = await api(`contents/${FILE}`);
    if (cur.ok) head = (await cur.json()).sha;
  }
  const r = await api(`contents/${FILE}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `contacts: ${Object.keys(JSON.parse(body)).length} resolved`,
      content: Buffer.from(body).toString('base64'),
      ...(head ? { sha: head } : {}),
    }),
  });
  if (!r.ok) return { pushed: 0, reason: `channel write failed (${r.status})` };
  return { pushed: Object.keys(JSON.parse(body)).length };
}
