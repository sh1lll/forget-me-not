#!/usr/bin/env node
// Browser version from the command line (after `npm install -g github:sh1lll/forget-me-not`, or `node cli.mjs`):
//   forget-me-not              start it and open it in your browser
//   forget-me-not --no-open    start it without opening a browser
//   forget-me-not --sync-once  sync with your shared folder and exit (for a scheduled task)
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--sync-once') && !process.argv.includes('--no-open')) process.argv.push('--open');
process.argv[1] = fileURLToPath(new URL('./server.mjs', import.meta.url)); // server.mjs runs as if started directly
await import('./server.mjs');
