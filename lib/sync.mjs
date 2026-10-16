// Two-way sync between this computer's AI memory and a shared folder (iCloud Drive, Dropbox, OneDrive, Google Drive,
// Syncthing …) that your other computers also sync with. server.mjs decides which folders pair up:
//   apps/<app>/…                     ← each app's "Everywhere" memory (~/.codex/AGENTS.md, Windsurf memories, …)
//   projects/<sync name>/            ← a Claude Code project's memory folder you chose to sync
//   custom/<name>/                   ← sources you added yourself
// A project syncs under a name you choose (default: its folder's name), because the same project lives at different
// paths on different machines (/Users/me/MyApp vs C:\Users\me\MyApp).
//
// Each computer remembers what every file looked like after its last sync (a hash per file). That is how a change is
// told apart from a deletion, and which side changed:
//   same on both sides               → nothing to do
//   only this computer changed it    → copy it to the shared folder (or delete it there)
//   only the shared folder changed   → copy it here (a deletion moves the local file to Deleted)
//   both changed it                  → MEMORY.md: keep both sides' lines; anything else: the newer one wins and the
//                                      other version goes to Deleted, so nothing is lost
// Safety: a project whose shared copy is missing entirely, or iCloud files not downloaded yet, is skipped; a sync that
// would delete more than half of a folder's files is held back until you confirm it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const SYNCED = /\.(md|mdc|txt|rules|markdown)$/i;

function listFiles(dir, only = null) {
  if (!isDir(dir)) return { files: new Map(), pendingCloud: [] };
  const files = new Map(); const pendingCloud = [];
  for (const f of fs.readdirSync(dir)) {
    const icloud = f.match(/^\.(.+)\.icloud$/); // iCloud placeholder: the file exists but isn't downloaded yet
    if (icloud) { if (only ? only.includes(icloud[1]) : SYNCED.test(icloud[1])) pendingCloud.push(icloud[1]); continue; }
    if (only ? !only.includes(f) : (!SYNCED.test(f) || f.startsWith('.'))) continue;
    const p = path.join(dir, f);
    try { const buf = fs.readFileSync(p); files.set(f, { p, hash: hash(buf), mtime: fs.statSync(p).mtimeMs, buf }); } catch { /* vanished */ }
  }
  return { files, pendingCloud };
}

function writeKeepingTime(dst, buf, mtime) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = `${dst}.fmn-tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dst);
  if (mtime) { const t = new Date(mtime); try { fs.utimesSync(dst, t, t); } catch { /* best effort */ } }
}

/** Union of two MEMORY.md versions: this computer's lines in order, then lines only the other side has. */
export function mergeIndex(local, remote) {
  const l = local.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const have = new Set(l.map((x) => x.trim()).filter(Boolean));
  const extra = remote.replace(/\r\n/g, '\n').split('\n').filter((x) => x.trim() && !have.has(x.trim()));
  return [...l, ...extra].join('\n') + '\n';
}

/**
 * Sync one pair of folders. `state` is this computer's record of the last sync for this pair ({file: hash}); the
 * returned `state` replaces it. `toTrash(path, info)` keeps a copy of anything about to be overwritten or deleted here.
 */
export function syncPair({ localDir, remoteDir, state = {}, toTrash, force = false, label = '', only = null }) {
  const L = listFiles(localDir, only); const R = listFiles(remoteDir, only);
  const result = { label, pulled: [], pushed: [], deletedHere: [], deletedThere: [], merged: [], conflicts: [], skipped: null };
  if (R.pendingCloud.length) { result.skipped = `${R.pendingCloud.length} file(s) in the shared folder aren't downloaded yet (iCloud). Open the folder in Finder to download them, then sync again.`; return { result, state }; }
  const known = Object.keys(state).length;
  if (known && !isDir(remoteDir)) { result.skipped = 'The shared copy is missing — not deleting anything here. If you removed it on purpose, stop syncing it in Settings.'; return { result, state }; }
  if (known && !isDir(localDir)) { result.skipped = 'This computer\'s copy is missing — not deleting anything in the shared folder.'; return { result, state }; }

  const names = new Set([...L.files.keys(), ...R.files.keys(), ...Object.keys(state)]);
  const plan = [];
  for (const f of names) {
    const l = L.files.get(f); const r = R.files.get(f); const m = state[f] ?? null;
    const lh = l?.hash ?? null; const rh = r?.hash ?? null;
    if (lh === rh) { plan.push({ f, op: 'same', h: lh }); continue; }
    if (lh === m) plan.push({ f, op: r ? 'pull' : 'delete-here', l, r });             // only the shared side changed
    else if (rh === m) plan.push({ f, op: l ? 'push' : 'delete-there', l, r });        // only this side changed
    else plan.push({ f, op: 'conflict', l, r });                                       // both changed (or both new)
  }

  const deletions = plan.filter((x) => x.op === 'delete-here' || x.op === 'delete-there').length;
  const total = Math.max(L.files.size, R.files.size);
  if (!force && deletions > 5 && deletions > total / 2) {
    result.skipped = `This sync would delete ${deletions} of ${total} files. Held back in case something went wrong — use "Sync anyway" if you meant it.`;
    result.needsForce = true;
    return { result, state };
  }

  const next = {};
  for (const x of plan) {
    const { f } = x; const lp = path.join(localDir, f); const rp = path.join(remoteDir, f);
    if (x.op === 'same') { if (x.h) next[f] = x.h; continue; }
    if (x.op === 'pull') { if (x.l) toTrash(lp, { reason: 'replaced by sync' }); writeKeepingTime(lp, x.r.buf, x.r.mtime); next[f] = x.r.hash; result.pulled.push(f); continue; }
    if (x.op === 'push') { writeKeepingTime(rp, x.l.buf, x.l.mtime); next[f] = x.l.hash; result.pushed.push(f); continue; }
    if (x.op === 'delete-here') { toTrash(lp, { reason: 'deleted on another computer' }); fs.unlinkSync(lp); result.deletedHere.push(f); continue; }
    if (x.op === 'delete-there') { fs.unlinkSync(rp); result.deletedThere.push(f); continue; }
    // conflict
    if (!x.l || !x.r) { // deleted on one side, changed on the other → keep the changed one
      const keep = x.l ?? x.r;
      if (x.l) writeKeepingTime(rp, keep.buf, keep.mtime); else writeKeepingTime(lp, keep.buf, keep.mtime);
      next[f] = keep.hash; result.conflicts.push(`${f}: deleted on one side, edited on the other — kept the edit`); continue;
    }
    if (f === 'MEMORY.md') {
      const merged = Buffer.from(mergeIndex(x.l.buf.toString('utf8'), x.r.buf.toString('utf8')));
      toTrash(lp, { reason: 'index merged by sync' });
      writeKeepingTime(lp, merged); writeKeepingTime(rp, merged); next[f] = hash(merged); result.merged.push(f); continue;
    }
    const localWins = x.l.mtime >= x.r.mtime;
    if (localWins) { toTrash(rp, { reason: 'older version from another computer' }); writeKeepingTime(rp, x.l.buf, x.l.mtime); next[f] = x.l.hash; }
    else { toTrash(lp, { reason: 'older version on this computer' }); writeKeepingTime(lp, x.r.buf, x.r.mtime); next[f] = x.r.hash; }
    result.conflicts.push(`${f}: edited on both — kept the newer (${localWins ? 'this computer' : 'other computer'}); the other is in Deleted`);
  }
  return { result, state: next };
}

export const syncNameFor = (folder) => path.basename(folder.replace(/[\\/]+$/, '')).replace(/[^\w .-]/g, '_') || 'root';

