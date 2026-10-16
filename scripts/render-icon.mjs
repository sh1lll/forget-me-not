// Renders assets/icon.svg to build/icon.png (1024², transparent corners). Run: npx electron scripts/render-icon.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html style="background:transparent;margin:0"><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(new URL('../build/icon.png', import.meta.url), img.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
