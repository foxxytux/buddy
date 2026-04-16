#!/usr/bin/env node
// Minimal Buddy fallback CLI for packaging tests (ES module)
import fs from 'fs';
import path from 'path';

function printHelp() {
  console.log('Buddy CLI (packaged fallback)');
  console.log('Usage: buddy [command]');
  console.log('Commands:');
  console.log('  --version     Show version');
  console.log('  help          Show this help');
}

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  try {
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(pkg.version || '0.0.0');
  } catch (e) {
    console.log('0.0.0');
  }
  process.exit(0);
}
if (args.length === 0 || args[0] === 'help') {
  printHelp();
  process.exit(0);
}

// Default behavior: print a simple response to indicate the CLI is runnable
console.log('Running Buddy (fallback packaged CLI).');
console.log('Arguments:', args.join(' '));
process.exit(0);
