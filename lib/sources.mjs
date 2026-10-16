// Every place an AI tool keeps memory or standing instructions on this computer.
//
// Kinds of item:
//   file   — one whole file is one memory (CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules …)
//   note   — a file inside a memory folder (Claude Code auto-memory, Windsurf memories, rules folders …)
//   index  — Claude Code's MEMORY.md, the list it reads at the start of every session (editable, never deleted)
//   entry  — one entity in a knowledge-graph memory file (the MCP "memory" server used by Claude Desktop, Cursor …)
//   row    — one row in an app's memory database (Open WebUI, Codex learned memories)
// Online services (Mem0, Letta) are added by the server from lib/connectors.mjs.
// An app is listed only when something of it exists on this computer.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { decodeProject } from './platform.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const H = os.homedir();
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const TEXT = /\.(md|mdc|txt|rules|markdown)$/i;

/**
 * global: files/folders that apply everywhere ("Everywhere"); project: files/folders looked for inside each project.
 * A path is relative to your home folder; where it differs by system it is { default, win32, darwin, linux }.
 * `home` decides whether the app counts as installed. Folders hold separate memories; a file is one memory.
 * An app is listed only when something of it exists on this computer.
 */
const cfgDir = (sub) => ({ default: `.config/${sub}`, win32: `AppData/Roaming/${sub}` });
export const APPS = [
  { id: 'claude-code', name: 'Claude Code', color: '#d97757', home: '.claude',
    global: [{ file: '.claude/CLAUDE.md' }], project: [{ file: 'CLAUDE.md' }, { file: 'CLAUDE.local.md' }, { file: '.claude/CLAUDE.md' }] },
  { id: 'codex', name: 'Codex', color: '#10a37f', home: '.codex',
    global: [{ file: '.codex/AGENTS.md' }, { file: '.codex/AGENTS.override.md', optional: true }, { dir: '.codex/memories', optional: true }], project: [{ file: 'AGENTS.override.md' }] },
  { id: 'agents-md', name: 'AGENTS.md (shared)', color: '#5b5bd6', home: null, global: [],
    project: [{ file: 'AGENTS.md' }] }, // read by Codex, Cursor, Amp, Jules, Factory, opencode and others
  { id: 'gemini', name: 'Gemini CLI', color: '#4285f4', home: '.gemini', global: [{ file: '.gemini/GEMINI.md' }], project: [{ file: 'GEMINI.md' }, { file: '.gemini/styleguide.md' }] },
  { id: 'cursor', name: 'Cursor', color: '#6b6b6b', home: '.cursor', global: [], project: [{ file: '.cursorrules' }, { dir: '.cursor/rules' }] },
  { id: 'windsurf', name: 'Windsurf', color: '#09b6a2', home: '.codeium/windsurf', global: [{ dir: '.codeium/windsurf/memories' }], project: [{ file: '.windsurfrules' }, { dir: '.windsurf/rules' }] },
  { id: 'copilot', name: 'GitHub Copilot', color: '#8957e5', home: { default: '.config/github-copilot', win32: 'AppData/Local/github-copilot' },
    global: [{ file: '.copilot/copilot-instructions.md', optional: true }], project: [{ file: '.github/copilot-instructions.md' }, { dir: '.github/instructions' }] },
  { id: 'cline', name: 'Cline', color: '#e5484d', home: 'Documents/Cline', global: [{ dir: 'Documents/Cline/Rules' }], project: [{ file: '.clinerules' }, { dir: '.clinerules' }, { dir: 'memory-bank' }] },
  { id: 'roo', name: 'Roo Code', color: '#f5a524', home: '.roo', global: [{ dir: '.roo/rules' }], project: [{ dir: '.roo/rules' }, { file: '.roorules' }] },
  { id: 'kilo', name: 'Kilo Code', color: '#f8d24b', home: '.kilocode', global: [{ dir: '.kilocode/rules' }], project: [{ dir: '.kilocode/rules' }] },
  { id: 'continue', name: 'Continue', color: '#1f6feb', home: '.continue', global: [{ dir: '.continue/rules' }], project: [{ dir: '.continue/rules' }] },
  { id: 'goose', name: 'Goose', color: '#9aa1ad', home: cfgDir('goose'),
    global: [{ dir: { default: '.config/goose/memory', win32: 'AppData/Roaming/Block/goose/config/memory' } }, { file: { default: '.config/goose/.goosehints', win32: 'AppData/Roaming/Block/goose/config/.goosehints' }, optional: true }],
    project: [{ dir: '.goose/memory' }, { file: '.goosehints' }] },
  { id: 'amp', name: 'Amp', color: '#f34e3f', home: cfgDir('amp'), global: [{ file: { default: '.config/amp/AGENTS.md', win32: 'AppData/Roaming/amp/AGENTS.md' } }], project: [] },
  { id: 'opencode', name: 'opencode', color: '#444', home: '.config/opencode', global: [{ file: '.config/opencode/AGENTS.md' }], project: [] },
  { id: 'factory', name: 'Factory (Droid)', color: '#ff7a00', home: '.factory', global: [{ file: '.factory/AGENTS.md' }], project: [] },
  { id: 'kiro', name: 'Kiro', color: '#7c3aed', home: '.kiro', global: [{ dir: '.kiro/steering' }], project: [{ dir: '.kiro/steering' }] },
  { id: 'qwen', name: 'Qwen Code', color: '#615ced', home: '.qwen', global: [{ file: '.qwen/QWEN.md' }], project: [{ file: 'QWEN.md' }] },
  { id: 'crush', name: 'Crush', color: '#e94fd7', home: cfgDir('crush'), global: [], project: [{ file: 'CRUSH.md' }] },
  { id: 'junie', name: 'JetBrains Junie', color: '#21d789', home: '.junie', global: [], project: [{ file: '.junie/guidelines.md' }] },
  { id: 'jetbrains-ai', name: 'JetBrains AI Assistant', color: '#fc801d', home: null, global: [], project: [{ dir: '.aiassistant/rules' }] },
  { id: 'augment', name: 'Augment', color: '#2b2b2b', home: '.augment', global: [{ dir: '.augment/rules', optional: true }], project: [{ file: '.augment-guidelines' }, { dir: '.augment/rules' }] },
  { id: 'trae', name: 'Trae', color: '#ff3b5c', home: '.trae', global: [], project: [{ dir: '.trae/rules' }] },
  { id: 'amazon-q', name: 'Amazon Q Developer', color: '#232f3e', home: '.aws/amazonq', global: [], project: [{ dir: '.amazonq/rules' }] },
  { id: 'firebase', name: 'Firebase Studio', color: '#ffa000', home: null, global: [], project: [{ file: '.idx/airules.md' }] },
  { id: 'openhands', name: 'OpenHands', color: '#6366f1', home: '.openhands', global: [{ dir: '.openhands/microagents', optional: true }], project: [{ dir: '.openhands/microagents' }] },
  { id: 'cody', name: 'Sourcegraph Cody', color: '#a112ff', home: null, global: [], project: [{ dir: '.sourcegraph' }] },
  { id: 'tabnine', name: 'Tabnine', color: '#6f42c1', home: '.tabnine', global: [], project: [{ dir: '.tabnine/guidelines' }] },
  { id: 'void', name: 'Void', color: '#000', home: null, global: [], project: [{ file: '.voidrules' }] },
  { id: 'codebuff', name: 'Codebuff', color: '#22c55e', home: null, global: [], project: [{ file: 'knowledge.md' }] },
  { id: 'hermes', name: 'Hermes Agent', color: '#b8860b', home: '.hermes', global: [{ dir: '.hermes/memories' }, { file: '.hermes/SOUL.md', optional: true }], project: [] },
  { id: 'aider', name: 'Aider', color: '#14b8a6', home: null, global: [], project: [{ file: 'CONVENTIONS.md' }] },
  { id: 'zed', name: 'Zed', color: '#084ccf', home: null, global: [], project: [{ file: '.rules' }] },
];

/** A home-relative location for this system (honours XDG_CONFIG_HOME on Linux). */
export function where(loc, { home = H, platform = process.platform } = {}) {
  if (loc == null) return null;
  let rel = typeof loc === 'string' ? loc : (loc[platform] ?? loc.default);
  if (platform !== 'win32' && platform !== 'darwin' && process.env.XDG_CONFIG_HOME && rel.startsWith('.config/')) return path.join(process.env.XDG_CONFIG_HOME, rel.slice(8));
  return path.join(home, ...rel.split('/'));
}

/** A throwaway location: inside the system temp folder, a scratch workspace, or a folder that no longer exists. */
const TMP = [os.tmpdir(), '/tmp', '/private/tmp', '/private/var/folders', '/var/folders'].map((t) => path.resolve(t));
export const isTemp = (folder) => !isDir(folder) || /scratch-workspaces/.test(folder) || TMP.some((t) => folder === t || folder.startsWith(t + path.sep));

// ── project folders worth looking in ──────────────────────────────────────────────────────────────────────────────
const SKIP = new Set(['Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public', 'node_modules', 'AppData', 'snap', 'go', 'miniconda3', 'anaconda3']);
let projectCache = { at: 0, list: [] };
export function projectFolders(claudeDir, extra = []) {
  if (Date.now() - projectCache.at < 60_000) return [...new Set([...projectCache.list, ...extra])];
  const out = new Set();
  const projects = path.join(claudeDir, 'projects');
  if (isDir(projects)) for (const id of fs.readdirSync(projects)) { const f = decodeProject(id); if (!isTemp(f) && f !== H) out.add(f); }
  // Your folders, two levels down (~/X and ~/Documents/X), skipping system and hidden ones.
  const look = (dir, depth) => {
    let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (!d.isDirectory() || d.name.startsWith('.') || SKIP.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (isDir(path.join(p, '.git')) || APPS.some((a) => a.project.some((m) => fs.existsSync(path.join(p, m.file ?? m.dir))))) out.add(p);
      if (depth > 1) look(p, depth - 1);
    }
  };
  look(H, 2);
  projectCache = { at: Date.now(), list: [...out] };
  return [...new Set([...out, ...extra])];
}
export const forgetProjectCache = () => { projectCache.at = 0; };

// ── reading items ─────────────────────────────────────────────────────────────────────────────────────────────────
export const idOf = (kind, p, ...extra) => `${kind}:${Buffer.from([p, ...extra.map(String)].filter((x, i) => i === 0 || x !== '').join('\0')).toString('base64url')}`;
export function parseId(id) {
  const m = /^(f|e|d|r):([\w-]+)$/.exec(id ?? ''); if (!m) return null;
  const [p, extra, extra2] = Buffer.from(m[2], 'base64url').toString().split('\0');
  return { kind: m[1], path: p, extra, extra2 };
}

function frontmatter(text) {
  text = text.replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) { const kv = line.match(/^\s*(\w+):\s*(.*)$/); if (kv && kv[2] !== '') meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').replace(/\\"/g, '"'); }
  return { meta, body: text.slice(m[0].length) };
}
const firstLine = (body) => (body.split('\n').map((l) => l.replace(/^#+\s*|^[-*]\s+/, '').trim()).find((l) => l && !/^-{3,}$/.test(l)) ?? '').slice(0, 160);

/** "2026-10-15-craft-finish-progress" → "Craft finish progress" */
const pretty = (n) => { const t = n.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '').replace(/[-_]+/g, ' ').trim() || n; return t[0].toUpperCase() + t.slice(1); };

function fileItem(p, { title, note = false } = {}) {
  const exists = isFile(p);
  let preview = ''; let t = title ?? path.basename(p); let size = 0; let mtime = 0;
  if (exists) {
    const st = fs.statSync(p); size = st.size; mtime = st.mtimeMs;
    if (size < 400_000) {
      const { meta, body } = frontmatter(fs.readFileSync(p, 'utf8'));
      if (note && meta.name) t = pretty(meta.name);
      else if (note) t = pretty(path.basename(p).replace(/\.(md|mdc|txt|markdown)$/i, ''));
      preview = (meta.description || firstLine(body)).slice(0, 160);
    }
  }
  return { id: idOf('f', p), kind: note ? 'note' : 'file', title: t, preview, path: p, exists, size, mtime };
}

function folderItems(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir).filter((f) => TEXT.test(f) && !f.startsWith('.')).map((f) => fileItem(path.join(dir, f), { note: true }))
    .sort((a, b) => b.mtime - a.mtime);
}

/** The MCP memory server's knowledge graph: one JSON object per line ({type:'entity'|'relation', …}). */
export function readGraph(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  let records;
  try { records = lines.map((l) => JSON.parse(l)); } catch { try { const j = JSON.parse(lines.join('\n')); records = [...(j.entities ?? []).map((e) => ({ type: 'entity', ...e })), ...(j.relations ?? []).map((r) => ({ type: 'relation', ...r }))]; } catch { records = []; } }
  return records;
}
function graphFiles() {
  const found = new Set();
  const npx = path.join(H, '.npm', '_npx');
  if (isDir(npx)) for (const d of fs.readdirSync(npx)) for (const f of ['memory.jsonl', 'memory.json']) {
    const p = path.join(npx, d, 'node_modules', '@modelcontextprotocol', 'server-memory', 'dist', f); if (isFile(p)) found.add(p);
  }
  // MEMORY_FILE_PATH set in an MCP config (Claude Desktop, Cursor, Claude Code)
  for (const cfg of [path.join(H, 'Library/Application Support/Claude/claude_desktop_config.json'), path.join(H, 'AppData/Roaming/Claude/claude_desktop_config.json'), path.join(H, '.config/Claude/claude_desktop_config.json'), path.join(H, '.cursor/mcp.json'), path.join(H, '.claude.json')]) {
    try { const txt = fs.readFileSync(cfg, 'utf8'); for (const m of txt.matchAll(/"MEMORY_FILE_PATH"\s*:\s*"([^"]+)"/g)) if (isFile(m[1])) found.add(m[1]); } catch { /* none */ }
  }
  return [...found];
}

// ── apps that keep memory in a local database ─────────────────────────────────────────────────────────────────────
// Read and changed with Node's built-in SQLite (Node 22.5+). A deleted row is kept (as JSON) so it can be put back.
let sqlite = null;
export function sqliteModule() {
  if (sqlite !== null) return sqlite || null;
  // Older Node versions print an "experimental" warning on first use; keep it out of the app's output.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...a));
  try { sqlite = require('node:sqlite'); } catch { sqlite = false; } finally { process.emitWarning = emit; }
  return sqlite || null;
}
/** Known database layouts: which table holds memories and which columns mean what. */
export const DB_KINDS = [
  { id: 'open-webui', app: 'Open WebUI', color: '#e5e7eb', table: 'memory', key: 'id', text: 'content', time: 'updated_at', timeScale: 1000, test: ['memory', 'content'] },
  { id: 'codex-db', app: 'Codex', color: '#10a37f', table: 'stage1_outputs', key: 'thread_id', text: 'raw_memory', title: 'rollout_slug', alt: 'rollout_summary', time: 'generated_at', timeScale: 1000, test: ['stage1_outputs', 'raw_memory'] },
];
export function dbKind(file) {
  const S = sqliteModule(); if (!S) return null;
  let db; try { db = new S.DatabaseSync(file, { readOnly: true }); } catch { return null; }
  try {
    for (const k of DB_KINDS) {
      const cols = db.prepare(`PRAGMA table_info(${k.test[0]})`).all().map((c) => c.name);
      if (cols.includes(k.test[1])) return k;
    }
    return null;
  } catch { return null; } finally { db.close(); }
}
export function dbRows(file, k) {
  const S = sqliteModule(); const db = new S.DatabaseSync(file, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${k.table} ORDER BY ${k.time} DESC LIMIT 2000`).all(); } finally { db.close(); }
}
export function dbWrite(file, fn) {
  const S = sqliteModule(); if (!S) throw new Error('This needs Node 22.5 or newer.');
  const db = new S.DatabaseSync(file); db.exec('PRAGMA busy_timeout = 3000');
  try { return fn(db); } finally { db.close(); }
}
function knownDbFiles() {
  const out = [];
  const tryGlob = (dir, depth, match) => { // tiny glob: walk `depth` levels looking for `match` at the end
    if (!isDir(dir)) return;
    if (depth === 0) { const p = path.join(dir, match); if (isFile(p)) out.push(p); return; }
    let names = []; try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) if (/^python|^\d|site-packages|lib|Lib|tools|open-webui|versions|envs/i.test(n)) tryGlob(path.join(dir, n), depth - 1, match);
  };
  // Open WebUI installed with pip / uv / pyenv / conda (Docker keeps it inside the container — add its webui.db by hand)
  const owui = path.join('site-packages', 'open_webui', 'data', 'webui.db');
  for (const root of [path.join(H, '.local', 'lib'), path.join(H, 'Library', 'Python'), '/opt/homebrew/lib', '/usr/local/lib', '/usr/lib',
    path.join(H, '.local', 'share', 'uv', 'tools', 'open-webui', 'lib'), path.join(H, '.pyenv', 'versions'), path.join(H, 'miniconda3', 'lib'), path.join(H, 'anaconda3', 'lib'),
    path.join(H, 'AppData', 'Local', 'Programs', 'Python'), path.join(H, 'AppData', 'Roaming', 'Python')]) {
    for (let d = 1; d <= 3; d++) tryGlob(root, d, owui);
  }
  if (process.env.DATA_DIR && isFile(path.join(process.env.DATA_DIR, 'webui.db'))) out.push(path.join(process.env.DATA_DIR, 'webui.db'));
  const codex = path.join(H, '.codex');
  if (isDir(codex)) for (const f of fs.readdirSync(codex)) if (/^memories_\d+\.sqlite$/.test(f)) out.push(path.join(codex, f));
  return [...new Set(out)];
}
function dbGroup(file, k, label) {
  const rows = dbRows(file, k);
  return { id: `db:${file}`, label, sub: file, scope: 'global', db: file, items: rows.map((r) => {
    const text = String(r[k.text] ?? '');
    const title = (k.title && r[k.title]) || (k.alt && String(r[k.alt] ?? '').split('\n')[0]) || text.split('\n')[0];
    return { id: idOf('d', file, k.id, r[k.key]), kind: 'row', title: String(title).slice(0, 90), preview: text.replace(/\s+/g, ' ').slice(0, 160), path: file, exists: true, size: text.length, mtime: Number(r[k.time] ?? 0) * (k.timeScale ?? 1) };
  }) };
}

/**
 * The full catalog: [{ id, name, color, groups: [{ id, label, sub, scope, addDir?, items }] }].
 * `custom` are sources the person added themselves: [{ name, path }].
 */
export function catalog({ claudeDir, custom = [], extraProjects = [] }) {
  const apps = [];
  const projects = projectFolders(claudeDir, extraProjects);
  for (const app of APPS) {
    const installed = app.home ? isDir(app.id === 'claude-code' ? claudeDir : where(app.home)) : false;
    const groups = [];
    // Everywhere
    const gItems = []; let addDir = null;
    for (const loc of app.global) {
      const p = app.id === 'claude-code' && loc.file === '.claude/CLAUDE.md' ? path.join(claudeDir, 'CLAUDE.md') : where(loc.file ?? loc.dir);
      if (loc.file) { if (isFile(p) || (installed && !loc.optional)) gItems.push(fileItem(p)); }
      else if (isDir(p) || (installed && !loc.optional)) { gItems.push(...folderItems(p)); addDir = addDir ?? p; }
    }
    if (gItems.length || addDir) groups.push({ id: `${app.id}:global`, label: 'Everywhere', sub: '', scope: 'global', addDir, items: gItems });
    // Claude Code's own per-project memory folders
    if (app.id === 'claude-code' && isDir(path.join(claudeDir, 'projects'))) {
      for (const pid of fs.readdirSync(path.join(claudeDir, 'projects'))) {
        const mem = path.join(claudeDir, 'projects', pid, 'memory');
        if (!isDir(mem)) continue;
        const notes = folderItems(mem);
        if (!notes.length) continue;
        const folder = decodeProject(pid);
        const idx = notes.findIndex((n) => path.basename(n.path) === 'MEMORY.md');
        if (idx >= 0) { const [ix] = notes.splice(idx, 1); ix.title = 'Index'; ix.preview = 'The list Claude reads at the start of every session here'; ix.kind = 'index'; notes.unshift(ix); }
        groups.push({ id: `claude-code:mem:${pid}`, label: folder === H ? 'Home folder' : path.basename(folder) || folder, sub: folder, scope: 'project', claudeProject: pid, temp: isTemp(folder), addDir: mem, items: notes });
      }
    }
    // Files inside projects
    for (const proj of projects) {
      const items = [];
      for (const loc of app.project) {
        const p = path.join(proj, loc.file ?? loc.dir);
        if (loc.file && isFile(p)) items.push(fileItem(p, { title: loc.file }));
        if (loc.dir && isDir(p)) items.push(...folderItems(p));
      }
      if (!items.length) continue;
      const existing = groups.find((g) => g.sub === proj);
      if (existing) existing.items.push(...items);
      else groups.push({ id: `${app.id}:proj:${proj}`, label: path.basename(proj), sub: proj, scope: 'project', items });
    }
    if (groups.length) apps.push({ id: app.id, name: app.name, color: app.color, installed, groups });
  }
  // MCP memory server graphs
  const graphs = graphFiles();
  if (graphs.length) {
    apps.push({ id: 'mcp-memory', name: 'Memory server (MCP)', color: '#0ea5e9', installed: true, groups: graphs.map((g) => ({
      id: `mcp-memory:${g}`, label: path.basename(path.dirname(path.dirname(g))) === 'server-memory' ? 'Knowledge graph' : path.basename(g), sub: g, scope: 'global', graph: g,
      items: readGraph(g).filter((r) => r.type === 'entity').map((e) => ({ id: idOf('e', g, e.name), kind: 'entry', title: e.name, preview: [e.entityType, ...(e.observations ?? [])].filter(Boolean).join(' · ').slice(0, 160), path: g, exists: true, size: 0, mtime: fs.statSync(g).mtimeMs })),
    })) });
  }
  // Apps with a memory database
  if (sqliteModule()) {
    for (const file of knownDbFiles()) {
      const k = dbKind(file); if (!k) continue;
      let app = apps.find((a) => a.name === k.app);
      if (!app) { app = { id: k.id === 'codex-db' ? 'codex' : k.id, name: k.app, color: k.color, installed: true, groups: [] }; apps.push(app); }
      try { app.groups.push(dbGroup(file, k, k.id === 'codex-db' ? 'Learned memories' : 'Memories')); } catch { /* locked or unreadable */ }
    }
  }
  // Sources you added
  if (custom.length) {
    apps.push({ id: 'custom', name: 'Your sources', color: '#888', installed: true, groups: custom.map((c, i) => ({
      id: `custom:${i}`, label: c.name || path.basename(c.path), sub: c.path, scope: 'global', custom: i,
    })).map((g) => {
      const k = isFile(g.sub) && /\.(db|sqlite3?)$/i.test(g.sub) ? dbKind(g.sub) : null;
      if (k) return { ...dbGroup(g.sub, k, g.label), custom: g.custom };
      return { ...g, addDir: isDir(g.sub) ? g.sub : null, items: isDir(g.sub) ? folderItems(g.sub) : isFile(g.sub) ? [fileItem(g.sub)] : [] };
    }) });
  }
  for (const a of apps) a.count = a.groups.reduce((n, g) => n + g.items.filter((i) => i.exists && i.kind !== 'index').length, 0);
  return apps;
}
