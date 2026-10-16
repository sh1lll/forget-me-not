// Platform differences in one place: how a Claude Code project folder name maps back to a real path, how to open a
// URL or show a file, and which folders are already synced, on macOS, Windows and Linux.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux' | …

const isDir = (p, fsImpl = fs) => { try { return fsImpl.statSync(p).isDirectory(); } catch { return false; } };

/**
 * Claude Code names a project's folder by replacing every character that is not a letter or digit with "-":
 *   /Users/me/My Project   → -Users-me-My-Project
 *   C:\Users\me\proj       → C--Users-me-proj
 * That is lossy ("-" may have been "/", "-", ".", " " or "_"), so walk the real disk and take the first path that
 * exists. `p` and `fsImpl` are injectable so the Windows/Linux cases can be tested on any machine.
 */
export function decodeProject(id, { p = path, fsImpl = fs, platform = PLATFORM } = {}) {
  let root; let rest;
  const drive = id.match(/^([A-Za-z])--(.*)$/);
  if (platform === 'win32' && drive) { root = `${drive[1].toUpperCase()}:\\`; rest = drive[2]; }
  else { root = p.sep === '\\' ? '\\' : '/'; rest = id.replace(/^-/, ''); }
  const parts = rest.split('-');
  const walk = (base, i) => {
    if (i === parts.length) return base;
    for (let j = parts.length; j > i; j--) {
      const words = parts.slice(i, j);
      const cands = new Set([words.join('-'), words.join('.'), words.join(' '), words.join('_')]);
      if (words[0] === '' && words.length > 1) cands.add('.' + words.slice(1).join('-')); // hidden folders: "-.claude" → "--claude"
      for (const seg of cands) {
        if (!seg) continue;
        const next = p.join(base, seg);
        if (isDir(next, fsImpl)) { const r = walk(next, j); if (r) return r; }
      }
    }
    return null;
  };
  return walk(root, 0) ?? p.join(root, ...parts.filter(Boolean));
}

/** The folder name Claude Code would give a project at `folder` (inverse of decodeProject). */
export const encodeProject = (folder) => folder.replace(/[^A-Za-z0-9]/g, '-');

export function openUrl(url) {
  if (PLATFORM === 'darwin') execFile('open', [url]);
  else if (PLATFORM === 'win32') execFile('cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')], { windowsVerbatimArguments: true });
  else execFile('xdg-open', [url]);
}

/** Show a file in Finder / Explorer / the Linux file manager (Linux opens the containing folder). */
export function reveal(target, exists) {
  if (PLATFORM === 'darwin') execFile('open', exists ? ['-R', target] : [path.dirname(target)]);
  else if (PLATFORM === 'win32') execFile('explorer.exe', exists ? [`/select,${target}`] : [path.dirname(target)]);
  else execFile('xdg-open', [path.dirname(target)]);
}

/** Folders that are probably already synced across devices — offered as one-click choices for the sync folder. */
export function syncFolderCandidates() {
  const h = os.homedir();
  const c = [
    ['iCloud Drive', path.join(h, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')],
    ['Dropbox', path.join(h, 'Dropbox')],
    ['OneDrive', process.env.OneDrive || path.join(h, 'OneDrive')],
    ['Google Drive', path.join(h, 'Google Drive')],
    ['Google Drive', 'G:\\My Drive'],
    ['Syncthing', path.join(h, 'Sync')],
  ];
  const cloud = path.join(h, 'Library', 'CloudStorage'); // macOS File Provider mounts (Dropbox, OneDrive, Google Drive …)
  if (isDir(cloud)) for (const d of fs.readdirSync(cloud)) c.push([d.split('-')[0].replace('GoogleDrive', 'Google Drive'), path.join(cloud, d)]);
  const seen = new Set();
  return c.filter(([, p]) => isDir(p) && !seen.has(p) && seen.add(p)).map(([label, p]) => ({ label, path: path.join(p, 'Forget-Me-Not') }));
}

export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ name, address: a.address, tailscale: a.address.startsWith('100.') });
    }
  }
  return out;
}
