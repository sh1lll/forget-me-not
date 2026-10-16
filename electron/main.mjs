// Forget-Me-Not desktop app: starts the same local server the browser version uses and shows it in a window.
// The page is plain web content with no access to Node or your files — everything goes through the local server,
// which only answers this computer (and your phone, if you turn that on in Settings).
import { app, BrowserWindow, shell, Menu, nativeImage, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/sh1lll/forget-me-not';
const here = path.dirname(fileURLToPath(import.meta.url));
const icon = nativeImage.createFromPath(path.join(here, '..', 'build', 'icon.png'));
let win = null;
let url = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 380, minHeight: 480,
    title: 'Forget-Me-Not', icon, backgroundColor: '#151514', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Stay on the app's own page; anything else (a link in a memory, say) opens in your browser.
  const own = (u) => u === url || u.startsWith(`${url}/`);
  const openOutside = (u) => { if (/^https?:\/\//.test(u)) shell.openExternal(u); };
  win.webContents.setWindowOpenHandler(({ url: u }) => { openOutside(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!own(u)) { e.preventDefault(); openOutside(u); } });
  win.loadURL(`${url}/?desktop=1`);
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // already open: the running copy brings its window forward
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && !icon.isEmpty()) app.dock?.setIcon(icon);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
      { role: 'help', submenu: [{ label: 'Forget-Me-Not on GitHub', click: () => shell.openExternal(REPO) }] },
    ]));
    const { start } = await import('../server.mjs');
    ({ url } = await start());
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  }).catch((e) => {
    dialog.showErrorBox('Forget-Me-Not couldn\'t start', String(e?.message ?? e));
    app.quit();
  });
}
