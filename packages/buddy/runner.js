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

async function main(argv = process.argv.slice(2)) {
  // Search for a prebuilt dist/cli.js in several likely locations
  const candidates = [
    join(PKG_ROOT, 'packages', 'coding-agent', 'dist', 'cli.js'),          // packaged layout
    join(PKG_ROOT, '..', '..', 'packages', 'coding-agent', 'dist', 'cli.js'), // repo layout when running from repo root
    join(process.cwd(), 'packages', 'coding-agent', 'dist', 'cli.js'),    // cwd-based
    join(__dirname, '..', 'packages', 'coding-agent', 'dist', 'cli.js')   // relative to installed package
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return spawnSync(process.execPath, [p, ...argv], { stdio: 'inherit' }).status || 0;
    }
  }

  // If no dist CLI found, avoid requiring ts-node to prevent hard failures. Only attempt ts-node
  // if it is resolvable from the current NODE_PATH / require paths.
  try {
    require.resolve('ts-node');
    // ts-node available; run source CLI via require hook
    return spawnSync('node', ['-r', 'ts-node/register', join(PKG_ROOT, 'packages', 'coding-agent', 'src', 'cli.ts'), ...argv], { stdio: 'inherit' }).status || 0;
  } catch (e) {
    // ts-node not available or not resolvable; skip
  }

  // Shell fallback: buddy-test.sh inside package
  const sh = join(PKG_ROOT, 'packages', 'buddy', 'buddy-test.sh');
  if (fs.existsSync(sh)) {
    tryExec(sh, argv, { shell: true });
    return 0;
  }

  console.error('Failed to locate runnable CLI. Ensure the package includes packages/coding-agent/dist/cli.js or install ts-node to run from source.');
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
