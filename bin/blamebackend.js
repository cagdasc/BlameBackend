#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isCli = args.includes('--cli') || args.includes('-c');
const filteredArgs = args.filter(a => a !== '--cli' && a !== '-c');

const targetScript = isCli
  ? path.join(rootDir, 'dist', 'desktop-cli.js')
  : path.join(rootDir, 'dist', 'server.js');

const child = spawn(process.execPath, [
  targetScript,
  ...filteredArgs
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production'
  }
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
