#!/usr/bin/env node
// Forget-Me-Not — see, edit, delete and sync the memory of every AI tool on this computer (Claude Code, Codex,
// Gemini CLI, Cursor, Windsurf, Copilot, Cline, …; see lib/sources.mjs). macOS, Windows and Linux, Node 18+.
// Runs on its own (opens a browser tab) or inside the desktop app (electron/main.mjs), which calls start().
//
// Local only (127.0.0.1) and every request needs the per-run token baked into the page. Phone access is opt-in: a
// second listener on the local network that also needs a private key. Nothing is hard-deleted — deleted items and the
// previous version of anything saved or synced go to ~/.forget-me-not/deleted and can be restored.
//
//   node server.mjs [--open]      → http://127.0.0.1:4517
//   node server.mjs --sync-once   → sync with the shared folder and exit (for a scheduled task)
//   FMN_PORT / FMN_CLAUDE_DIR / FMN_DATA_DIR (point at copies to try things safely)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openUrl, reveal, syncFolderCandidates, lanAddresses, PLATFORM } from './lib/platform.mjs';
import { syncPair, syncNameFor } from './lib/sync.mjs';
import { catalog, parseId, readGraph, APPS, forgetProjectCache, where, idOf, DB_KINDS, dbWrite } from './lib/sources.mjs';
import { SERVICES } from './lib/connectors.mjs';

const HOME = os.homedir();
const CLAUDE = path.resolve(process.env.FMN_CLAUDE_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'));
const DATA = path.resolve(process.env.FMN_DATA_DIR || path.join(HOME, '.forget-me-not')); // this app's own files
const TRASH = path.join(DATA, 'deleted');
const CONFIG = path.join(DATA, 'settings.json');
const SYNC_STATE = path.join(DATA, 'sync-state.json');
let PORT = Number(process.env.FMN_PORT || 4517);
const TOKEN = crypto.randomBytes(24).toString('hex');
const HTML = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const ICON = fs.readFileSync(new URL('./assets/icon.svg', import.meta.url), 'utf8');

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const read = (p) => fs.readFileSync(p, 'utf8');
const loadJson = (p, d) => { try { return JSON.parse(read(p)); } catch { return d; } };
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }

let cfg = { deviceName: os.hostname().replace(/\.local$/, ''), syncDir: '', autoSync: true, links: {}, lanEnabled: false, lanKey: '', custom: [], connections: [], ...loadJson(CONFIG, {}) };
if (!cfg.lanKey) cfg.lanKey = crypto.randomBytes(18).toString('base64url');
// Holds API keys for connected services: readable by you only.
const saveCfg = () => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 }); try { fs.chmodSync(CONFIG, 0o600); } catch { /* Windows */ } };

// ── catalog (cached briefly; any write clears it) ─────────────────────────────────────────────────────────────────
let cache = null;
const remote = new Map(); // connection id → { at, items, error }
async function refreshRemote(maxAge = 60_000) {
  const stale = cfg.connections.filter((c) => { const cur = remote.get(c.id); return !cur || Date.now() - cur.at >= maxAge; });
  if (!stale.length) return;
  await Promise.all(stale.map(async (c) => {
    const cur = remote.get(c.id);
    try { remote.set(c.id, { at: Date.now(), items: await SERVICES[c.service].list(c) }); }
    catch (e) { remote.set(c.id, { at: Date.now(), items: cur?.items ?? [], error: e.message }); }
  }));
  cache = null;
}
function remoteApps() {
  const out = [];
  for (const c of cfg.connections) {
    const svc = SERVICES[c.service]; const r = remote.get(c.id) ?? { items: [], error: 'Loading…' };
    let app = out.find((a) => a.id === `svc-${c.service}`);
    if (!app) { app = { id: `svc-${c.service}`, name: svc.name, color: svc.color, installed: true, online: true, groups: [] }; out.push(app); }
    app.groups.push({ id: `svc:${c.id}`, label: c.label || svc.name, sub: (c.url || svc.defaultUrl).replace(/^https?:\/\//, ''), scope: 'online', error: r.error, items: r.items.map((m) => ({ id: idOf('r', c.id, m.rid), kind: 'remote', title: m.title || '(untitled)', preview: m.text.replace(/\s+/g, ' ').slice(0, 160), path: '', exists: true, size: m.text.length, mtime: m.mtime })) });
  }
  for (const a of out) a.count = a.groups.reduce((n, g) => n + g.items.length, 0);
  return out;
}
function apps() { if (!cache || Date.now() - cache.at > 4000) cache = { at: Date.now(), apps: [...catalog({ claudeDir: CLAUDE, custom: cfg.custom }), ...remoteApps()] }; return cache.apps; }
const changed = () => { cache = null; };
function findItem(id) {
  for (const a of apps()) for (const g of a.groups) { const it = g.items.find((i) => i.id === id); if (it) return { app: a, group: g, item: it }; }
  throw httpErr(404, 'That memory is gone — reload.');
}
function findGroup(gid) { for (const a of apps()) { const g = a.groups.find((x) => x.id === gid); if (g) return { app: a, group: g }; } throw httpErr(404, 'not found'); }

// ── trash ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function toTrash(src, { kind, label = '', original = src, indexLines = [], reason = '', content = null }) {
  fs.mkdirSync(TRASH, { recursive: true });
  const entry = `${new Date().toISOString().replace(/[:.]/g, '-')}__${kind}__${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(TRASH, entry); fs.mkdirSync(dir);
  const file = path.basename(original) || 'item.txt';
  if (content !== null) fs.writeFileSync(path.join(dir, file), content); else fs.copyFileSync(src, path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ kind, label, original, file, indexLines, reason, at: Date.now() }, null, 2));
  return entry;
}
/** A Deleted entry's folder — only names this app created (no "..", no separators). */
function trashDir(entry) {
  if (typeof entry !== 'string' || !/^\d{4}-[\w-]+$/.test(entry)) throw httpErr(400, 'bad entry');
  return path.join(TRASH, entry);
}
function trashList() {
  if (!isDir(TRASH)) return [];
  return fs.readdirSync(TRASH).filter((e) => isDir(path.join(TRASH, e))).map((entry) => ({ entry, ...loadJson(path.join(TRASH, entry, 'meta.json'), {}) }))
    .filter((t) => t.original).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}
function restore(entry) {
  const dir = trashDir(entry); const meta = loadJson(path.join(dir, 'meta.json'), null);
  if (!meta) throw httpErr(404, 'Not in Deleted any more.');
  if (meta.kind === 'remote') throw httpErr(400, 'This was deleted on an online service and can\'t be put back from here — copy its text and add it there again.');
  if (meta.kind === 'row' || meta.kind === 'row-edit') {
    const { table, key, row } = JSON.parse(read(path.join(dir, meta.file)));
    if (!DB_KINDS.some((k) => k.table === table && k.key === key)) throw httpErr(400, 'Unknown table.');
    const cols = Object.keys(row).filter((c) => /^\w+$/.test(c));
    dbWrite(meta.original, (db) => {
      if (meta.kind === 'row-edit') db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(row[key]);
      db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
    });
    fs.rmSync(dir, { recursive: true }); changed();
    return { restored: meta.label };
  }
  const original = path.resolve(meta.original);
  if (meta.kind === 'entry') { // one knowledge-graph entity: put its lines back
    const lines = read(path.join(dir, meta.file)).split('\n').filter(Boolean);
    const cur = exists(original) ? read(original).replace(/\n*$/, '\n') : '';
    fs.writeFileSync(original, cur + lines.join('\n') + '\n');
  } else {
    if (exists(original)) toTrash(original, { kind: 'edit', label: path.basename(original), reason: 'replaced by a restore' });
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.copyFileSync(path.join(dir, meta.file), original);
    if (meta.indexLines?.length) {
      const ip = path.join(path.dirname(original), 'MEMORY.md');
      const cur = exists(ip) ? read(ip) : '';
      const add = meta.indexLines.filter((l) => !cur.includes(l));
      if (add.length) fs.writeFileSync(ip, cur.replace(/\n*$/, '\n') + add.join('\n') + '\n');
    }
  }
  fs.rmSync(dir, { recursive: true }); changed();
  return { restored: meta.label || meta.file };
}

// ── database rows and online memories ──
const dbKindOf = (id) => DB_KINDS.find((k) => k.id === id);
function rowOf(id) { const { path: file, extra: kid, extra2: key } = parseId(id); const k = dbKindOf(kid); if (!k) throw httpErr(400, 'bad item'); return { file, k, key }; }
function remoteOf(id) {
  const { path: cid, extra: rid } = parseId(id);
  const c = cfg.connections.find((x) => x.id === cid); if (!c) throw httpErr(404, 'That service is no longer connected.');
  const m = remote.get(cid)?.items.find((x) => String(x.rid) === rid); if (!m) throw httpErr(404, 'That memory is gone — reload.');
  return { c, m, svc: SERVICES[c.service] };
}

// ── edit / delete / add ───────────────────────────────────────────────────────────────────────────────────────────
function itemContent(id) {
  const { item, app, group } = findItem(id);
  const base = { title: item.title, app: app.name, where: group.label, path: item.path, kind: item.kind };
  if (item.kind === 'entry') {
    const { extra } = parseId(id);
    const e = readGraph(item.path).find((r) => r.type === 'entity' && r.name === extra);
    return { ...base, content: (e?.observations ?? []).join('\n'), mtime: item.mtime, hint: 'One fact per line' };
  }
  if (item.kind === 'row') {
    const { file, k, key } = rowOf(id);
    const row = dbWrite(file, (db) => db.prepare(`SELECT ${k.text} AS t FROM ${k.table} WHERE ${k.key} = ?`).get(key));
    return { ...base, path: file, content: String(row?.t ?? ''), mtime: item.mtime };
  }
  if (item.kind === 'remote') { const { m, svc } = remoteOf(id); return { ...base, path: '', content: m.text, mtime: m.mtime, online: svc.name }; }
  return { ...base, content: item.exists ? read(item.path) : '', mtime: item.exists ? fs.statSync(item.path).mtimeMs : 0, missing: !item.exists };
}

async function saveItem({ id, content, expectedMtime }) {
  if (typeof content !== 'string') throw httpErr(400, 'content required');
  const { item } = findItem(id);
  if (item.kind === 'row') {
    const { file, k, key } = rowOf(id);
    dbWrite(file, (db) => {
      const old = db.prepare(`SELECT * FROM ${k.table} WHERE ${k.key} = ?`).get(key);
      if (old) toTrash(file, { kind: 'row-edit', label: item.title, original: file, content: JSON.stringify({ table: k.table, key: k.key, row: old }) });
      const now = k.timeScale === 1000 ? Math.floor(Date.now() / 1000) : Date.now();
      db.prepare(`UPDATE ${k.table} SET ${k.text} = ?, ${k.time} = ? WHERE ${k.key} = ?`).run(content, now, key);
    });
    changed(); return { saved: true };
  }
  if (item.kind === 'remote') {
    const { c, m, svc } = remoteOf(id);
    await svc.save(c, m.rid, content); m.text = content; m.title = content.split('\n')[0].slice(0, 90) || m.title; m.mtime = Date.now();
    changed(); return { saved: true };
  }
  if (item.kind === 'entry') {
    const { extra } = parseId(id);
    const recs = readGraph(item.path);
    const e = recs.find((r) => r.type === 'entity' && r.name === extra);
    if (!e) throw httpErr(404, 'That memory is gone — reload.');
    toTrash(item.path, { kind: 'edit', label: extra, reason: 'earlier version' });
    e.observations = content.split('\n').map((l) => l.trim()).filter(Boolean);
    fs.writeFileSync(item.path, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    changed(); return { saved: true };
  }
  if (item.exists) {
    if (expectedMtime && Math.abs(fs.statSync(item.path).mtimeMs - expectedMtime) > 1) throw httpErr(409, 'This changed while you were editing. Close it and open it again.');
    if (read(item.path) === content) return { saved: false };
    toTrash(item.path, { kind: 'edit', label: item.title, reason: 'earlier version' });
  }
  fs.mkdirSync(path.dirname(item.path), { recursive: true });
  fs.writeFileSync(item.path, content);
  changed(); return { saved: true };
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const linksIn = (line) => [...[...line.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => decode(m[1])), ...[...line.matchAll(/\[\[([^\]|]+)\]\]/g)].map((m) => `${m[1].trim()}.md`)];

async function deleteItem(id) {
  const { item, group } = findItem(id);
  if (item.kind === 'row') {
    const { file, k, key } = rowOf(id);
    const entry = dbWrite(file, (db) => {
      const old = db.prepare(`SELECT * FROM ${k.table} WHERE ${k.key} = ?`).get(key);
      if (!old) throw httpErr(404, 'Already gone.');
      const e = toTrash(file, { kind: 'row', label: item.title, original: file, content: JSON.stringify({ table: k.table, key: k.key, row: old }) });
      db.prepare(`DELETE FROM ${k.table} WHERE ${k.key} = ?`).run(key);
      return e;
    });
    changed(); return { entry, label: item.title };
  }
  if (item.kind === 'remote') {
    const { c, m, svc } = remoteOf(id);
    await svc.remove(c, m.rid);
    const entry = toTrash('', { kind: 'remote', label: m.title, original: `${svc.name}/${m.rid}.txt`, content: m.text, reason: `deleted on ${svc.name}` });
    const r = remote.get(c.id); if (r) r.items = r.items.filter((x) => x !== m);
    changed(); return { entry, label: m.title, online: svc.name };
  }
  if (item.kind === 'index') throw httpErr(400, 'The index can be edited but not deleted.');
  if (item.kind === 'entry') {
    const { extra } = parseId(id);
    const recs = readGraph(item.path);
    const gone = recs.filter((r) => (r.type === 'entity' && r.name === extra) || (r.type === 'relation' && (r.from === extra || r.to === extra)));
    const entry = toTrash(item.path, { kind: 'entry', label: extra, content: gone.map((r) => JSON.stringify(r)).join('\n') });
    fs.writeFileSync(item.path, recs.filter((r) => !gone.includes(r)).map((r) => JSON.stringify(r)).join('\n') + '\n');
    changed(); return { entry, label: extra };
  }
  if (!item.exists) throw httpErr(400, 'It\'s already empty.');
  let indexLines = [];
  if (group.claudeProject) { // also drop its line from the Claude Code index
    const ip = path.join(path.dirname(item.path), 'MEMORY.md'); const file = path.basename(item.path);
    if (exists(ip)) {
      const lines = read(ip).split('\n');
      indexLines = lines.filter((l) => { const k = linksIn(l); return k.includes(file) && k.every((x) => x === file); });
      if (indexLines.length) { toTrash(ip, { kind: 'edit', label: 'Index', reason: 'before removing a line' }); fs.writeFileSync(ip, lines.filter((l) => !indexLines.includes(l)).join('\n')); }
    }
  }
  const entry = toTrash(item.path, { kind: 'item', label: item.title, indexLines });
  fs.unlinkSync(item.path);
  changed(); return { entry, label: item.title };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
function addItem({ groupId, title, body }) {
  const { group } = findGroup(groupId);
  if (!group.addDir) throw httpErr(400, 'Edit the file here instead.');
  if (!title?.trim()) throw httpErr(400, 'Give it a title.');
  fs.mkdirSync(group.addDir, { recursive: true });
  let file = `${slug(title)}.md`; let n = 2;
  while (exists(path.join(group.addDir, file))) file = `${slug(title)}-${n++}.md`;
  const summary = (body || '').trim().split('\n')[0].slice(0, 150);
  if (group.claudeProject) {
    fs.writeFileSync(path.join(group.addDir, file), `---\nname: ${slug(title)}\ndescription: ${JSON.stringify(summary || title.trim())}\nmetadata:\n  type: user\n---\n${(body || '').trim()}\n`);
    const ip = path.join(group.addDir, 'MEMORY.md');
    const cur = exists(ip) ? read(ip) : '# Memory index\n';
    if (exists(ip)) toTrash(ip, { kind: 'edit', label: 'Index', reason: 'before adding a line' });
    fs.writeFileSync(ip, cur.replace(/\n*$/, '\n') + `- [${title.trim().replace(/[[\]\n]/g, ' ')}](${file})${summary ? ` — ${summary}` : ''}\n`);
  } else {
    fs.writeFileSync(path.join(group.addDir, file), `# ${title.trim()}\n\n${(body || '').trim()}\n`);
  }
  changed(); return { ok: true };
}

function search(q) {
  const needle = q.toLowerCase(); const out = [];
  for (const a of apps()) for (const g of a.groups) for (const it of g.items) {
    if (!it.exists) continue;
    let hit = `${it.title} ${it.preview}`.toLowerCase().includes(needle);
    let snippet = it.preview;
    if (!hit && it.path && ['file', 'note', 'index'].includes(it.kind) && it.size < 200_000) {
      const text = read(it.path); const i = text.toLowerCase().indexOf(needle);
      if (i >= 0) { hit = true; snippet = text.slice(Math.max(0, i - 50), i + 110).replace(/\s+/g, ' ').trim(); }
    }
    if (hit) out.push({ ...it, app: a.name, color: a.color, where: g.label, preview: snippet });
    if (out.length >= 200) return out;
  }
  return out;
}

// ── sync ──────────────────────────────────────────────────────────────────────────────────────────────────────────
let syncState = loadJson(SYNC_STATE, {}); let lastSync = null; let syncing = false;
const remoteRoot = () => cfg.syncDir && path.resolve(cfg.syncDir);

/** What syncs: every app's "Everywhere" files and folders, knowledge graphs, your own sources, Claude Code projects you tick. */
function syncPairs() {
  const pairs = [];
  for (const app of APPS) {
    const byDir = new Map();
    for (const loc of app.global) {
      const p = app.id === 'claude-code' && loc.file === '.claude/CLAUDE.md' ? path.join(CLAUDE, 'CLAUDE.md') : where(loc.file ?? loc.dir);
      if (loc.dir) { if (isDir(p)) pairs.push({ key: `apps/${app.id}/${path.basename(p)}`, label: app.name, localDir: p }); continue; }
      if (!isDir(path.dirname(p))) continue;
      byDir.set(path.dirname(p), [...(byDir.get(path.dirname(p)) ?? []), path.basename(p)]);
    }
    for (const [d, only] of byDir) pairs.push({ key: `apps/${app.id}/files`, label: app.name, localDir: d, only });
  }
  for (const a of apps()) if (a.id === 'mcp-memory') a.groups.forEach((g, i) => pairs.push({ key: `apps/mcp-memory/${i}`, label: 'Memory server', localDir: path.dirname(g.graph), only: [path.basename(g.graph)] }));
  for (const c of cfg.custom) {
    const key = `custom/${syncNameFor(c.name || c.path)}`;
    if (isDir(c.path)) pairs.push({ key, label: c.name, localDir: c.path });
    else if (exists(c.path)) pairs.push({ key, label: c.name, localDir: path.dirname(c.path), only: [path.basename(c.path)] });
  }
  for (const [pid, key] of Object.entries(cfg.links)) if (key) pairs.push({ key: `projects/${key}`, label: `Claude Code · ${key}`, localDir: path.join(CLAUDE, 'projects', pid, 'memory') });
  return pairs;
}

function runSync({ force = false } = {}) {
  const root = remoteRoot();
  if (!root) throw httpErr(400, 'Pick a sync folder first.');
  if (syncing) throw httpErr(409, 'Already syncing.');
  syncing = true;
  try {
    const results = [];
    for (const pr of syncPairs()) {
      const remoteDir = path.join(root, ...pr.key.split('/'));
      const trashFor = (p, info) => { if (!exists(p)) return; const original = p.startsWith(root + path.sep) ? path.join(pr.localDir, path.basename(p)) : p; toTrash(p, { kind: 'sync', label: path.basename(p), original, reason: info.reason }); };
      const r = syncPair({ localDir: pr.localDir, remoteDir, only: pr.only ?? null, state: syncState[pr.key] ?? {}, toTrash: trashFor, force, label: pr.label });
      syncState[pr.key] = r.state; results.push(r.result);
    }
    fs.writeFileSync(SYNC_STATE, JSON.stringify(syncState, null, 2));
    fs.mkdirSync(path.join(root, 'devices'), { recursive: true });
    fs.writeFileSync(path.join(root, 'devices', `${cfg.deviceName.replace(/[^\w.-]/g, '_')}.json`), JSON.stringify({ name: cfg.deviceName, platform: PLATFORM, lastSync: Date.now() }, null, 2));
    const count = (r) => (r.pulled?.length ?? 0) + (r.pushed?.length ?? 0) + (r.deletedHere?.length ?? 0) + (r.deletedThere?.length ?? 0) + (r.merged?.length ?? 0);
    lastSync = { at: Date.now(), changes: results.reduce((a, r) => a + count(r), 0), problems: results.filter((r) => r.skipped).map((r) => `${r.label}: ${r.skipped}`), conflicts: results.flatMap((r) => r.conflicts ?? []), needsForce: results.some((r) => r.needsForce) };
    changed();
    return lastSync;
  } finally { syncing = false; }
}

function settings(lan) {
  const root = remoteRoot();
  const devices = root && isDir(path.join(root, 'devices')) ? fs.readdirSync(path.join(root, 'devices')).filter((f) => f.endsWith('.json')).map((f) => loadJson(path.join(root, 'devices', f), null)).filter(Boolean) : [];
  const remoteProjects = root && isDir(path.join(root, 'projects')) ? fs.readdirSync(path.join(root, 'projects')).filter((k) => isDir(path.join(root, 'projects', k))) : [];
  const claude = apps().find((a) => a.id === 'claude-code');
  const used = new Set(Object.values(cfg.links).filter(Boolean).map((k) => k.toLowerCase()));
  // A sync name for every Claude Code project, unique ignoring case ("MyApp" vs "myapp" are one folder on Mac/Windows).
  const projects = (claude?.groups ?? []).filter((g) => g.claudeProject && !g.temp).map((g) => {
    let key = cfg.links[g.claudeProject];
    if (!key) { key = syncNameFor(g.sub); let up = path.dirname(g.sub); while (used.has(key.toLowerCase()) && up !== path.dirname(up)) { key = `${syncNameFor(up)}-${key}`; up = path.dirname(up); } used.add(key.toLowerCase()); }
    return { id: g.claudeProject, name: g.label, folder: g.sub, count: g.items.length - 1, on: !!cfg.links[g.claudeProject], key };
  });
  const linked = new Set(Object.values(cfg.links).filter(Boolean));
  return {
    deviceName: cfg.deviceName, platform: PLATFORM, syncDir: cfg.syncDir, ok: !!root && isDir(root), autoSync: cfg.autoSync, syncing, lastSync,
    candidates: syncFolderCandidates(), devices, projects, elsewhere: remoteProjects.filter((k) => !linked.has(k)), custom: cfg.custom,
    lan: { enabled: cfg.lanEnabled, port: PORT + 1, key: lan ? undefined : cfg.lanKey, addresses: lanAddresses() }, remote: lan,
    services: Object.entries(SERVICES).map(([id, v]) => ({ id, name: v.name, fields: v.fields.map((f) => ({ key: f.key, label: f.label, secret: !!f.secret })) })),
    connections: cfg.connections.map((c) => ({ id: c.id, service: c.service, name: SERVICES[c.service]?.name, label: c.label, url: c.url || '', error: remote.get(c.id)?.error ?? null, count: remote.get(c.id)?.items.length ?? 0 })),
  };
}

let autoTimer = null;
function scheduleAuto(delay = 120_000) {
  clearTimeout(autoTimer);
  if (!cfg.autoSync || !remoteRoot()) return;
  autoTimer = setTimeout(() => { try { runSync(); } catch (e) { lastSync = { at: Date.now(), problems: [e.message], changes: 0, conflicts: [] }; } scheduleAuto(); }, delay);
  autoTimer.unref?.();
}

// ── http ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const bodyOf = (req) => new Promise((ok, bad) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 5e6) { bad(httpErr(413, 'Too big.')); req.destroy(); } });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(httpErr(400, 'bad json')); } });
});
const cookieKey = (req) => (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === 'fmnkey')?.[1];
const safeEq = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const expand = (p) => path.resolve(String(p).trim().replace(/^~(?=$|[\\/])/, HOME));

const handler = (lan) => async (req, res) => {
  try {
    const host = req.headers.host ?? '';
    const url = new URL(req.url, `http://${host || 'x'}`);
    if (!lan) { if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return json(res, 403, { error: 'local only' }); }
    else {
      if (!cfg.lanEnabled) return json(res, 403, { error: 'Phone access is off on the computer.' });
      if (safeEq(url.searchParams.get('key'), cfg.lanKey)) { res.writeHead(302, { location: '/', 'set-cookie': `fmnkey=${cfg.lanKey}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` }); return res.end(); }
      if (!safeEq(cookieKey(req), cfg.lanKey)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Open the phone link from Forget-Me-Not on your computer (Settings).'); }
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = crypto.randomBytes(16).toString('base64');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      return res.end(HTML.replace('__NONCE__', nonce).replace('__TOKEN__', TOKEN).replace('__REMOTE__', lan ? '1' : ''));
    }
    if (req.method === 'GET' && url.pathname === '/icon.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }); return res.end(ICON); }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (!safeEq(req.headers['x-fmn-token'], TOKEN)) return json(res, 403, { error: 'Reload the page.' });
    const q = Object.fromEntries(url.searchParams); const r = url.pathname.slice(5); const M = req.method;
    const wrote = (d) => { scheduleAuto(5_000); return json(res, 200, d); };
    if (M === 'GET' && ['apps', 'app', 'search'].includes(r)) await refreshRemote(q.fresh ? 0 : 60_000);
    if (M === 'GET' && r === 'apps') return json(res, 200, { home: HOME, apps: apps().map((a) => ({ id: a.id, name: a.name, color: a.color, count: a.count, online: !!a.online })), deleted: trashList().length, sync: { on: !!cfg.syncDir, ok: !!remoteRoot() && isDir(remoteRoot()), last: lastSync?.at ?? null, problems: lastSync?.problems?.length ?? 0 } });
    if (M === 'GET' && r === 'app') { const a = apps().find((x) => x.id === q.id); if (!a) throw httpErr(404, 'not found'); return json(res, 200, a); }
    if (M === 'GET' && r === 'item') return json(res, 200, itemContent(q.id));
    if (M === 'GET' && r === 'search') return json(res, 200, q.q?.trim() ? search(q.q.trim()) : []);
    if (M === 'GET' && r === 'deleted') return json(res, 200, trashList());
    if (M === 'PUT' && r === 'item') return wrote(await saveItem(await bodyOf(req)));
    if (M === 'DELETE' && r === 'item') return wrote(await deleteItem((await bodyOf(req)).id));
    if (M === 'GET' && r === 'deleted/text') {
      const dir = trashDir(q.entry); const meta = loadJson(path.join(dir, 'meta.json'), null);
      if (meta?.kind !== 'remote') throw httpErr(404, 'not found');
      return json(res, 200, { text: read(path.join(dir, path.basename(meta.file))) });
    }
    if (M === 'POST' && r === 'item') return wrote(addItem(await bodyOf(req)));
    if (M === 'POST' && r === 'restore') return wrote(restore((await bodyOf(req)).entry));
    if (M === 'POST' && r === 'reveal') { if (lan) throw httpErr(400, 'Only on the computer itself.'); const { item } = findItem((await bodyOf(req)).id); reveal(item.path, item.exists); return json(res, 200, { ok: true }); }
    if (M === 'GET' && r === 'settings') return json(res, 200, settings(lan));
    if (M === 'POST' && r === 'sync') { const out = runSync({ force: !!(await bodyOf(req)).force }); scheduleAuto(); return json(res, 200, out); }
    if (M === 'POST' && r === 'settings') {
      const b = await bodyOf(req);
      // From a phone, nothing that points the app at other files or folders on the computer, and no connecting services.
      if (lan && ['syncDir', 'linkElsewhere', 'addSource', 'connect', 'deviceName', 'newLanKey'].some((k) => b[k] !== undefined)) throw httpErr(403, 'Change this on the computer itself.');
      if (typeof b.deviceName === 'string' && b.deviceName.trim()) cfg.deviceName = b.deviceName.trim().slice(0, 60);
      if (typeof b.autoSync === 'boolean') cfg.autoSync = b.autoSync;
      if (typeof b.syncDir === 'string') { if (b.syncDir.trim()) { const d = expand(b.syncDir); fs.mkdirSync(d, { recursive: true }); cfg.syncDir = d; } else cfg.syncDir = ''; }
      if (b.project) { // { id, on, key }
        const { id, on, key } = b.project;
        if (!/^[\w.-]+$/.test(id ?? '')) throw httpErr(400, 'bad project');
        if (!on) delete cfg.links[id];
        else {
          const k = String(key ?? '').trim().replace(/[^\w .-]/g, '_'); if (!k) throw httpErr(400, 'Give it a name.');
          const clash = Object.entries(cfg.links).find(([i, v]) => i !== id && v?.toLowerCase() === k.toLowerCase());
          if (clash) throw httpErr(409, `"${k}" is already used by another project.`);
          cfg.links[id] = k;
        }
      }
      if (b.linkElsewhere) { // a Claude Code project that so far only exists on another computer
        if (!b.linkElsewhere.folder) throw httpErr(400, 'Type the folder where it lives on this computer.');
        const id = expand(b.linkElsewhere.folder).replace(/[^A-Za-z0-9]/g, '-');
        fs.mkdirSync(path.join(CLAUDE, 'projects', id, 'memory'), { recursive: true }); cfg.links[id] = String(b.linkElsewhere.key);
      }
      if (b.addSource) { const p = expand(b.addSource.path || ''); if (!b.addSource.path || !exists(p)) throw httpErr(400, 'Nothing at that path.'); cfg.custom.push({ name: (b.addSource.name || path.basename(p)).slice(0, 60), path: p }); forgetProjectCache(); }
      if (typeof b.removeSource === 'number') cfg.custom.splice(b.removeSource, 1);
      if (b.connect) { // { service, apiKey, url, userId }
        const svc = SERVICES[b.connect.service]; if (!svc) throw httpErr(400, 'Unknown service.');
        const c = { id: crypto.randomBytes(4).toString('hex'), service: b.connect.service, apiKey: String(b.connect.apiKey ?? '').trim(), url: String(b.connect.url ?? '').trim(), userId: String(b.connect.userId ?? '').trim(), label: svc.name };
        if (c.service === 'mem0' && !c.apiKey) throw httpErr(400, 'Paste your Mem0 API key.');
        const items = await svc.list(c); // fails loudly on a wrong key or URL, before anything is saved
        remote.set(c.id, { at: Date.now(), items }); cfg.connections.push(c);
      }
      if (b.disconnect) { cfg.connections = cfg.connections.filter((c) => c.id !== b.disconnect); remote.delete(b.disconnect); }
      if (typeof b.lanEnabled === 'boolean') { if (lan && !b.lanEnabled) throw httpErr(400, 'Turn this off on the computer.'); cfg.lanEnabled = b.lanEnabled; applyLan(); }
      if (b.newLanKey) cfg.lanKey = crypto.randomBytes(18).toString('base64url');
      saveCfg(); changed(); scheduleAuto(); return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) { return json(res, e.status ?? 500, { error: e.message }); }
};

// ── start ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let lanServer = null;
function applyLan() {
  if (cfg.lanEnabled && !lanServer) { lanServer = http.createServer(handler(true)); lanServer.on('error', (e) => { console.warn(`Phone access couldn't start: ${e.message}`); lanServer = null; }); lanServer.listen(PORT + 1, '0.0.0.0'); }
  else if (!cfg.lanEnabled && lanServer) { lanServer.close(); lanServer = null; }
}

/** Start the local server. Resolves { url } — or { url, alreadyRunning: true } when another copy already serves it. */
export function start({ port = PORT } = {}) {
  PORT = port;
  return new Promise((resolve, reject) => {
    const local = http.createServer(handler(false));
    local.on('error', (e) => (e.code === 'EADDRINUSE' ? resolve({ url: `http://127.0.0.1:${PORT}`, alreadyRunning: true }) : reject(e)));
    local.listen(PORT, '127.0.0.1', () => { applyLan(); scheduleAuto(3_000); resolve({ url: `http://127.0.0.1:${PORT}`, close: () => { local.close(); lanServer?.close(); } }); });
  });
}

// Run directly: `node server.mjs [--open] [--sync-once [--force]]`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sync-once')) {
    try { const out = runSync({ force: process.argv.includes('--force') }); console.log(`${out.changes} change(s)`); for (const p of out.problems) console.log('!', p); process.exit(out.needsForce ? 2 : 0); }
    catch (e) { console.error(e.message); process.exit(1); }
  }
  const { url, alreadyRunning } = await start();
  console.log(alreadyRunning ? `Forget-Me-Not is already open → ${url}` : `Forget-Me-Not → ${url}`);
  if (process.argv.includes('--open')) openUrl(url);
  if (alreadyRunning) setTimeout(() => process.exit(0), 300);
}
