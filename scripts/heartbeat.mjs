// Written by every scheduled check, even when nothing changed — the site reads
// it live via /api/heartbeat so "checked Xm ago" is always true.
import { writeJson } from '../lib/store.mjs';
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.log('heartbeat: no blob token, skipped');
  process.exit(0);
}
await writeJson('heartbeat.json', { checkedAt: Date.now() });
console.log('heartbeat: ok');
