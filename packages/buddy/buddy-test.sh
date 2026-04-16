#!/usr/bin/env bash
# packaged buddy-test.sh - lightweight launcher
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
# If the package was installed globally, the repo files are here; try to execute the repo wrapper if present
# Prefer bundled binary if exists under lib or dist; fallback to a minimal message
if [ -x "$DIR/../node_modules/.bin/buddy" ]; then
  exec "$DIR/../node_modules/.bin/buddy" "$@"
fi
# If the package includes a CLI implementation in the monorepo, attempt to run it
if [ -f "$DIR/../packages/coding-agent/dist/cli.js" ]; then
  node "$DIR/../packages/coding-agent/dist/cli.js" "$@"
  exit $?
fi
# Fallback: print help and exit
cat <<'EOF'
Buddy CLI

This package provides the Buddy interactive agent.
If you installed globally from the monorepo package, ensure the package includes a built CLI (packages/coding-agent/dist/cli.js) or run from source.

To run locally (development):
  ./buddy-test.sh

EOF
exit 0
