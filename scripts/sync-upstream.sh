#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/badlogic/pi-mono.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
TARGET_BRANCH="${TARGET_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
else
  git remote set-url "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

git config rerere.enabled true

echo "Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --tags

FORK_POINT="$(git merge-base "$TARGET_BRANCH" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
BACKUP_BRANCH="backup/${TARGET_BRANCH}-${STAMP}"
SYNC_BRANCH="sync/${TARGET_BRANCH}-${STAMP}"

echo "Creating backup branch: $BACKUP_BRANCH"
git branch "$BACKUP_BRANCH" "$TARGET_BRANCH"

echo "Creating sync branch: $SYNC_BRANCH"
git branch "$SYNC_BRANCH" "$TARGET_BRANCH"
git switch "$SYNC_BRANCH"

echo "Rebasing buddy changes from $FORK_POINT onto $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
if git rebase --rebase-merges --onto "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" "$FORK_POINT"; then
  echo
  echo "Upstream sync branch ready: $SYNC_BRANCH"
  echo "Review with: git log --oneline --decorate --graph $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..$SYNC_BRANCH"
  echo "If good, fast-forward your main branch:" 
  echo "  git switch $TARGET_BRANCH"
  echo "  git merge --ff-only $SYNC_BRANCH"
else
  echo
  echo "Rebase stopped for conflicts. Resolve them, then continue with:"
  echo "  git rebase --continue"
  echo
  echo "If you want to abort the sync attempt:"
  echo "  git rebase --abort"
  echo "  git switch $TARGET_BRANCH"
  echo
  echo "Your original state is preserved in: $BACKUP_BRANCH"
  exit 1
fi
