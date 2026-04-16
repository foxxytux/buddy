#!/usr/bin/env node
// bootstrap runner for Buddy package
// Tries to run built CLI, falls back to ts-node if available, otherwise runs buddy-test.sh
const { spawnSync } = require('child_process');
const { join, dirname } = require('path');
const fs = require('fs');
const SCRIPT_DIR = dirname(require.main?.filename || process.argv[1]);
const PKG_ROOT = join(SCRIPT_DIR, '..');

function tryExec(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  return r.status === 0;
}

// 1) dist/cli.js
const distCli = join(PKG_ROOT, 'packages', 'coding-agent', 'dist', 'cli.js');
if (fs.existsSync(distCli)) {
  process.exit(spawnSync(process.execPath, [distCli, ...process.argv.slice(2)], { stdio: 'inherit' }).status || 0);
}

// 2) try to run with ts-node/register if installed
try {
  // check for local ts-node in node_modules
  const tsnodeLocal = join(PKG_ROOT, 'node_modules', '.bin', 'ts-node');
  if (fs.existsSync(tsnodeLocal)) {
    process.exit(spawnSync('node', ['-r', 'ts-node/register', join(PKG_ROOT, 'packages', 'coding-agent', 'src', 'cli.ts'), ...process.argv.slice(2)], { stdio: 'inherit' }).status || 0);
  }
} catch (e) {
  // ignore
}

// 3) try global ts-node
try {
  process.exit(spawnSync('node', ['-r', 'ts-node/register', join(PKG_ROOT, 'packages', 'coding-agent', 'src', 'cli.ts'), ...process.argv.slice(2)], { stdio: 'inherit' }).status || 0);
} catch (e) {
  // ignore
}

// 4) shell fallback: buddy-test.sh
const sh = join(PKG_ROOT, 'packages', 'buddy', 'buddy-test.sh');
if (fs.existsSync(sh)) {
  tryExec(sh, process.argv.slice(2), { shell: true });
  process.exit(0);
}

console.error('Failed to locate runnable CLI. Ensure the package includes packages/coding-agent/dist/cli.js or install ts-node to run from source.');
process.exit(1);
