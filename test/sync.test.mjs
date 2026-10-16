// Two simulated computers (A, B) syncing through one shared folder. Run: node test/sync.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncPair, mergeIndex } from '../lib/sync.mjs';
import { decodeProject, encodeProject } from '../lib/platform.mjs';

let n = 0; const ok = (label, c) => { assert.ok(c, label); n++; console.log('  ✓', label); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-sync-'));
const A = path.join(root, 'A'), B = path.join(root, 'B'), S = path.join(root, 'shared');
for (const d of [A, B]) fs.mkdirSync(d, { recursive: true });
const trashed = [];
const toTrash = (p, info) => { if (fs.existsSync(p)) trashed.push([path.basename(p), info.reason]); };
const st = { A: {}, B: {} };
const sync = (who, extra = {}) => { const r = syncPair({ localDir: who === 'A' ? A : B, remoteDir: S, state: st[who], toTrash, ...extra }); st[who] = r.state; return r.result; };
const w = (dir, f, text, mtime) => { fs.writeFileSync(path.join(dir, f), text); if (mtime) fs.utimesSync(path.join(dir, f), mtime / 1000, mtime / 1000); };
const r = (dir, f) => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null;

w(A, 'MEMORY.md', '# idx\n- [one](one.md)\n'); w(A, 'one.md', 'one v1'); w(A, 'two.md', 'two v1');
let res = sync('A');
ok('first sync from A uploads everything', res.pushed.length === 3 && r(S, 'one.md') === 'one v1');
res = sync('B');
ok('B downloads everything', res.pulled.length === 3 && r(B, 'two.md') === 'two v1');
ok('a second sync changes nothing', (() => { const x = sync('A'); const y = sync('B'); return !x.pushed.length && !x.pulled.length && !y.pushed.length && !y.pulled.length; })());

w(B, 'one.md', 'one v2 from B'); sync('B'); res = sync('A');
ok('an edit on B reaches A', r(A, 'one.md') === 'one v2 from B' && res.pulled.includes('one.md'));

fs.unlinkSync(path.join(A, 'two.md')); sync('A'); res = sync('B');
ok('a delete on A reaches B — and B keeps a copy in Trash', r(B, 'two.md') === null && trashed.some(([f, why]) => f === 'two.md' && /another computer/.test(why)));

w(A, 'MEMORY.md', '# idx\n- [one](one.md)\n- [from A](a.md)\n'); w(B, 'MEMORY.md', '# idx\n- [one](one.md)\n- [from B](b.md)\n');
sync('A'); res = sync('B'); sync('A');
ok('index edited on both: both sides keep both lines', ['A', 'B'].every((x) => { const t = r(x === 'A' ? A : B, 'MEMORY.md'); return t.includes('from A') && t.includes('from B'); }) && res.merged.includes('MEMORY.md'));

const now = Date.now();
w(A, 'one.md', 'A older', now - 60_000); w(B, 'one.md', 'B newer', now);
sync('A'); trashed.length = 0; res = sync('B'); sync('A');
ok('note edited on both: the newer wins everywhere', r(A, 'one.md') === 'B newer' && r(B, 'one.md') === 'B newer');
ok('…and the older one is kept in Trash, not lost', trashed.some(([f]) => f === 'one.md'));

for (let i = 0; i < 10; i++) w(A, `n${i}.md`, `n${i}`); sync('A'); sync('B');
for (let i = 0; i < 10; i++) fs.unlinkSync(path.join(A, `n${i}.md`));
res = sync('A');
ok('a sync that would delete most notes is held back', !!res.needsForce && r(S, 'n0.md') === 'n0');
res = sync('A', { force: true });
ok('…and goes through when confirmed', res.deletedThere.length === 10);

const st2 = { ...st.B }; fs.renameSync(S, S + '-gone');
res = syncPair({ localDir: B, remoteDir: S, state: st2, toTrash }).result;
ok('shared folder missing (unmounted drive): nothing deleted here', !!res.skipped && r(B, 'one.md') === 'B newer');
fs.renameSync(S + '-gone', S);

fs.writeFileSync(path.join(S, '.late.md.icloud'), '');
res = sync('B');
ok('iCloud files not downloaded yet: sync waits instead of guessing', /aren't downloaded/.test(res.skipped ?? ''));
fs.unlinkSync(path.join(S, '.late.md.icloud'));

ok('mergeIndex keeps order and adds only new lines', mergeIndex('a\nb\n', 'b\nc\n') === 'a\nb\nc\n');
ok('Windows line endings do not duplicate index lines', mergeIndex('a\r\nb\r\n', 'a\nb\n') === 'a\nb\n');

// Project folder names on other systems, against a fake disk.
const fakeFs = (dirs) => ({ statSync: (p) => { if (dirs.has(p)) return { isDirectory: () => true }; throw new Error('ENOENT'); } });
const win = fakeFs(new Set(['C:\\', 'C:\\Users', 'C:\\Users\\sam', 'C:\\Users\\sam\\My Project', 'C:\\Users\\sam\\trading-system']));
ok('Windows: C--Users-sam-My-Project → C:\\Users\\sam\\My Project', decodeProject('C--Users-sam-My-Project', { p: path.win32, fsImpl: win, platform: 'win32' }) === 'C:\\Users\\sam\\My Project');
ok('Windows: dashes kept where the folder really has one', decodeProject('C--Users-sam-trading-system', { p: path.win32, fsImpl: win, platform: 'win32' }) === 'C:\\Users\\sam\\trading-system');
const lin = fakeFs(new Set(['/', '/home', '/home/sam', '/home/sam/.config', '/home/sam/.config/app', '/home/sam/my_app']));
ok('Linux: hidden folders (/home/sam/.config/app)', decodeProject('-home-sam--config-app', { p: path.posix, fsImpl: lin, platform: 'linux' }) === '/home/sam/.config/app');
ok('Linux: underscores (/home/sam/my_app)', decodeProject('-home-sam-my-app', { p: path.posix, fsImpl: lin, platform: 'linux' }) === '/home/sam/my_app');
ok('encode is what Claude Code does', encodeProject('C:\\Users\\sam\\My Project') === 'C--Users-sam-My-Project' && encodeProject('/Users/sam/x.y') === '-Users-sam-x-y');

fs.rmSync(root, { recursive: true });
console.log(`\nsync.test: ${n} checks passed`);
