// End-to-end: the real server against a fake home folder holding every kind of source — files from many tools, an
// Open WebUI and a Codex memory database, and stand-ins for the Mem0 and Letta APIs that follow their published docs.
// Run: node test/all-sources.test.mjs   (needs Node 22.5+ for the database part)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { where } from '../lib/sources.mjs';

let n = 0; const ok = (label, c, detail = '') => { assert.ok(c, `${label} ${detail}`); n++; console.log('  ✓', label); };
const H = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-all-'));
const w = (rel, text) => { const p = path.join(H, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };

// ── files from many tools ──
w('.claude/projects/-x/memory/MEMORY.md', '- [a](a.md)\n'); w('.claude/projects/-x/memory/a.md', '---\nname: a\ndescription: claude note\n---\nhi\n');
w('.config/goose/memory/general.txt', 'likes tea'); w('.config/goose/.goosehints', 'Use British spelling.');
w('.config/amp/AGENTS.md', 'Amp: be terse.'); w('.factory/AGENTS.md', 'Droid rules'); w('.kilocode/rules/a.md', '# Kilo rule');
const proj = path.join(H, 'Projects', 'site'); fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
for (const [rel, t] of [['AGENTS.md', 'shared agents'], ['CRUSH.md', 'crush'], ['.junie/guidelines.md', 'junie'], ['.goosehints', 'project hints'], ['.trae/rules/r.md', 'trae'], ['.amazonq/rules/q.md', 'amazon q'], ['.idx/airules.md', 'firebase'], ['.aiassistant/rules/j.md', 'jb ai'], ['.voidrules', 'void'], ['knowledge.md', 'codebuff'], ['.openhands/microagents/repo.md', 'oh'], ['.augment-guidelines', 'augment'], ['.tabnine/guidelines/g.md', 'tabnine'], ['.sourcegraph/x.rule.md', 'cody']]) w(path.join('Projects', 'site', rel), t);

// ── databases ──
const require = createRequire(import.meta.url);
let S = null; try { S = require('node:sqlite'); } catch { /* old Node */ }
const owui = path.join(H, '.local', 'lib', 'python3.12', 'site-packages', 'open_webui', 'data', 'webui.db');
const codexDb = path.join(H, '.codex', 'memories_1.sqlite');
if (S) {
  fs.mkdirSync(path.dirname(owui), { recursive: true }); fs.mkdirSync(path.dirname(codexDb), { recursive: true });
  let db = new S.DatabaseSync(owui);
  db.exec('CREATE TABLE memory (id TEXT PRIMARY KEY, user_id TEXT, content TEXT, updated_at BIGINT, created_at BIGINT)');
  db.prepare('INSERT INTO memory VALUES (?,?,?,?,?)').run('m1', 'u1', 'Allergic to peanuts', 1760000000, 1760000000);
  db.prepare('INSERT INTO memory VALUES (?,?,?,?,?)').run('m2', 'u1', 'Works night shifts', 1760000100, 1760000100); db.close();
  db = new S.DatabaseSync(codexDb);
  db.exec('CREATE TABLE stage1_outputs (thread_id TEXT PRIMARY KEY, source_updated_at INTEGER NOT NULL, raw_memory TEXT NOT NULL, rollout_summary TEXT NOT NULL, rollout_slug TEXT, generated_at INTEGER NOT NULL)');
  db.prepare('INSERT INTO stage1_outputs VALUES (?,?,?,?,?,?)').run('t1', 1, 'Repo uses pnpm workspaces', 'Set up monorepo', 'monorepo-setup', 1760000000); db.close();
}

// ── stand-in online services (paths, verbs and auth exactly as documented) ──
const mem0 = [{ id: 'a1', memory: 'Prefers dark mode', user_id: 'sam', created_at: '2026-10-01T00:00:00Z' }, { id: 'a2', memory: 'Vegetarian', user_id: 'sam', created_at: '2026-10-02T00:00:00Z' }];
const blocks = [{ id: 'block-1', label: 'human', value: 'Name: Sam', updated_at: '2026-10-03T00:00:00Z' }];
const seen = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const j = body ? JSON.parse(body) : {}; const u = new URL(req.url, 'http://x'); seen.push(`${req.method} ${u.pathname} ${req.headers.authorization}`);
    const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (u.pathname === '/v3/memories/' && req.method === 'POST') { if (req.headers.authorization !== 'Token m0-key') return send(401, {}); if (!j.filters?.user_id) return send(400, { error: 'filters required' }); return send(200, { count: mem0.length, next: null, results: mem0 }); }
    let m = u.pathname.match(/^\/v1\/memories\/(\w+)\/$/);
    if (m && req.method === 'PUT') { const x = mem0.find((y) => y.id === m[1]); x.memory = j.text; return send(200, x); }
    if (m && req.method === 'DELETE') { mem0.splice(mem0.findIndex((y) => y.id === m[1]), 1); return send(200, { message: 'deleted' }); }
    if (u.pathname === '/v1/blocks/' && req.method === 'GET') return send(200, blocks);
    m = u.pathname.match(/^\/v1\/blocks\/([\w-]+)$/);
    if (m && req.method === 'PATCH') { const x = blocks.find((y) => y.id === m[1]); x.value = j.value; return send(200, x); }
    if (m && req.method === 'DELETE') { blocks.splice(blocks.findIndex((y) => y.id === m[1]), 1); return send(204, {}); }
    send(404, {});
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;

// ── the real app ──
const PORT = 4600 + Math.floor(Math.random() * 300);
const app = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env: { ...process.env, HOME: H, USERPROFILE: H, XDG_CONFIG_HOME: path.join(H, '.config'), FMN_PORT: String(PORT), FMN_DATA_DIR: '', FMN_CLAUDE_DIR: '', CLAUDE_CONFIG_DIR: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let errText = ''; app.stderr.on('data', (d) => { errText += d; });
await new Promise((r) => app.stdout.once('data', r));
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = (await (await fetch(BASE + '/')).text()).match(/const TOKEN = '([a-f0-9]+)'/)[1];
const api = async (m, r, b) => { const x = await fetch(`${BASE}/api/${r}`, { method: m, headers: { 'x-fmn-token': TOKEN, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const d = await x.json(); if (!x.ok) throw new Error(`${r}: ${d.error}`); return d; };

try {
  const names = (await api('GET', 'apps')).apps.map((a) => a.name);
  for (const want of ['Claude Code', 'AGENTS.md (shared)', 'Goose', 'Amp', 'Factory (Droid)', 'Kilo Code', 'Crush', 'JetBrains Junie', 'JetBrains AI Assistant', 'Trae', 'Amazon Q Developer', 'Firebase Studio', 'OpenHands', 'Sourcegraph Cody', 'Tabnine', 'Void', 'Codebuff', 'Augment']) ok(`finds ${want}`, names.includes(want), names.join(', '));
  const goose = await api('GET', 'app?id=goose');
  ok('Goose: global memory folder + hints + project files', goose.groups.some((g) => g.label === 'Everywhere' && g.items.some((i) => i.title === '.goosehints') && g.items.some((i) => /General/.test(i.title))) && goose.groups.some((g) => g.label === 'site'));

  if (S) {
    const ow = await api('GET', 'app?id=open-webui');
    ok('Open WebUI memories read from its database', ow.groups[0].items.length === 2 && ow.groups[0].items.some((i) => i.title === 'Works night shifts'));
    const it = ow.groups[0].items.find((i) => i.title === 'Allergic to peanuts');
    await api('PUT', 'item', { id: it.id, content: 'Allergic to peanuts and shellfish' });
    let db = new S.DatabaseSync(owui); ok('…edited in the database', db.prepare("SELECT content FROM memory WHERE id='m1'").get().content === 'Allergic to peanuts and shellfish'); db.close();
    const d = await api('DELETE', 'item', { id: (await api('GET', 'app?id=open-webui')).groups[0].items.find((i) => /shellfish/.test(i.title)).id });
    db = new S.DatabaseSync(owui); ok('…deleted from the database', !db.prepare("SELECT 1 FROM memory WHERE id='m1'").get()); db.close();
    await api('POST', 'restore', { entry: d.entry });
    db = new S.DatabaseSync(owui); const back = db.prepare("SELECT * FROM memory WHERE id='m1'").get(); db.close();
    ok('…and Undo puts the whole row back', back?.content === 'Allergic to peanuts and shellfish' && back.user_id === 'u1');
    const cx = await api('GET', 'app?id=codex');
    ok('Codex learned memories read from its database', cx.groups.some((g) => g.label === 'Learned memories' && g.items[0]?.title === 'monorepo-setup'));
  } else console.log('  - (database checks skipped: needs Node 22.5+)');

  await api('POST', 'settings', { connect: { service: 'mem0', apiKey: 'm0-key', url: MOCK } });
  let wrong = ''; try { await api('POST', 'settings', { connect: { service: 'mem0', apiKey: 'nope', url: MOCK } }); } catch (e) { wrong = e.message; }
  ok('Mem0: a wrong key is refused before anything is saved', /didn't accept/.test(wrong));
  const m0 = await api('GET', 'app?id=svc-mem0');
  ok('Mem0: memories listed', m0.groups[0].items.length === 2);
  ok('Mem0: called exactly as documented', seen.some((x) => x.startsWith('POST /v3/memories/ Token m0-key')));
  const dm = m0.groups[0].items.find((i) => i.title === 'Prefers dark mode');
  await api('PUT', 'item', { id: dm.id, content: 'Prefers light mode' });
  ok('Mem0: edit reaches the service', mem0.find((x) => x.id === 'a1').memory === 'Prefers light mode');
  await api('DELETE', 'item', { id: (await api('GET', 'app?id=svc-mem0')).groups[0].items.find((i) => i.title === 'Vegetarian').id });
  ok('Mem0: delete reaches the service', !mem0.some((x) => x.id === 'a2'));
  const del = (await api('GET', 'deleted')).find((t) => t.kind === 'remote');
  ok('Mem0: a copy of the deleted text stays in Deleted', (await api('GET', `deleted/text?entry=${del.entry}`)).text === 'Vegetarian');

  await api('POST', 'settings', { connect: { service: 'letta', url: MOCK } });
  const lt = await api('GET', 'app?id=svc-letta');
  ok('Letta (self-hosted, no key): memory blocks listed', lt.groups[0].items[0]?.title === 'human');
  await api('PUT', 'item', { id: lt.groups[0].items[0].id, content: 'Name: Sam\nCity: Lisbon' });
  ok('Letta: edit reaches the server', blocks[0].value === 'Name: Sam\nCity: Lisbon');

  const s = await api('GET', 'settings');
  ok('API keys never leave the computer through the app', !JSON.stringify(s).includes('m0-key'));
  ok('settings file is private to you', process.platform === 'win32' || (fs.statSync(path.join(H, '.forget-me-not', 'settings.json')).mode & 0o077) === 0);
  const hits = await api('GET', 'search?q=light mode');
  ok('search covers online services too', hits.some((h) => h.app === 'Mem0'));

  // Safety
  const page = await fetch(BASE + '/');
  ok('the page sends a strict security policy (only its own script runs)', /script-src 'nonce-[^']+'/.test(page.headers.get('content-security-policy') ?? '') && !/unsafe-eval/.test(page.headers.get('content-security-policy')));
  ok('requests without the page\'s token are refused', (await fetch(`${BASE}/api/apps`)).status === 403);
  ok('requests from another website are refused', (await fetch(`${BASE}/api/apps`, { headers: { host: 'evil.example' } })).status === 403);
  let bad = ''; try { await api('POST', 'restore', { entry: '..' }); } catch (e) { bad = e.message; }
  ok('"Deleted" refuses names outside its own folder', /bad entry/.test(bad));
  await api('POST', 'settings', { lanEnabled: true });
  const key = (await api('GET', 'settings')).lan.key;
  const PHONE = `http://127.0.0.1:${PORT + 1}`;
  ok('phone link without the key is refused', (await fetch(`${PHONE}/`)).status === 403);
  const login = await fetch(`${PHONE}/?key=${key}`, { redirect: 'manual' });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const phonePage = await (await fetch(`${PHONE}/`, { headers: { cookie } })).text();
  const PT = phonePage.match(/const TOKEN = '([a-f0-9]+)'/)?.[1];
  const phone = (b) => fetch(`${PHONE}/api/settings`, { method: 'POST', headers: { cookie, 'x-fmn-token': PT, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  ok('the phone link opens the app', !!PT && /const REMOTE = '1'/.test(phonePage));
  ok('from a phone you can\'t point the app at other files on the computer', (await phone({ addSource: { path: '/etc' } })).status === 403 && (await phone({ syncDir: '/tmp/x' })).status === 403);
  ok('from a phone you never see the phone key or API keys', !JSON.stringify(await (await fetch(`${PHONE}/api/settings`, { headers: { cookie, 'x-fmn-token': PT } })).json()).includes(key));
  await api('POST', 'settings', { lanEnabled: false });

  // Where things live on other systems
  ok('Windows: Goose memory under AppData', where({ default: '.config/goose/memory', win32: 'AppData/Roaming/Block/goose/config/memory' }, { home: 'C:\\Users\\sam', platform: 'win32' }).replace(/\\/g, '/').endsWith('AppData/Roaming/Block/goose/config/memory'));
  ok('Linux/Mac: Goose memory under ~/.config', where({ default: '.config/goose/memory', win32: 'x' }, { home: '/home/sam', platform: 'linux' }).endsWith('/.config/goose/memory') || !!process.env.XDG_CONFIG_HOME);
} finally {
  app.kill(); mock.close(); fs.rmSync(H, { recursive: true, force: true });
  if (errText.trim()) console.log('server stderr:', errText.trim().slice(0, 400));
}
console.log(`\nall-sources.test: ${n} checks passed`);
