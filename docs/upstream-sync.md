# Upstream Sync Workflow

Buddy is a fork of `badlogic/pi-mono`.

To keep Buddy up to date with upstream while preserving Buddy-specific changes:

## One-command sync

```bash
npm run sync:upstream
```

This script will:

1. Ensure the `upstream` remote points to `https://github.com/badlogic/pi-mono.git`
2. Fetch `upstream/main`
3. Enable `git rerere` so repeated conflict resolutions are remembered
4. Create a backup branch from your current branch
5. Create a dedicated sync branch
6. Rebase Buddy-only commits onto the latest `upstream/main`

## After the script finishes

If the rebase succeeds:

```bash
git switch main
git merge --ff-only <sync-branch>
```

If conflicts occur:

```bash
git status
# resolve conflicts
git add <resolved-files>
git rebase --continue
```

To abort a failed sync attempt:

```bash
git rebase --abort
git switch main
```

Your original branch state is always preserved in the generated `backup/*` branch.

## Recommended policy

- Keep Buddy-specific branding, UX, and packaging changes in small, focused commits.
- Prefer rebasing Buddy commits on top of upstream rather than merging upstream into Buddy.
- Let `git rerere` learn recurring rename/branding conflicts.
- Run `npm run check` after every upstream sync before pushing.
