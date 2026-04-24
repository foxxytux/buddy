# AGENTS

This file documents recommended workflows and commands for working with the Buddy repository (@foxxytux/buddy). Keep it short and actionable.

## Workflow
- Work on a single, well-scoped task per branch. Prefer feature branches: `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`.
- Keep changes small and self-contained. Use a todo/task tool (see example below) for multi-step or research tasks.
- Run repository checks and local CLI before opening a PR.

Example todo skeleton (use in your task tracker or TODO.md)
- [ ] Reproduce current behavior locally
- [ ] Add failing test or minimal repro
- [ ] Implement fix or feature
- [ ] Run lint & tests
- [ ] Update docs (README / AGENTS / package READMEs)
- [ ] Open PR with description and testing notes

## Code changes
- Branch naming: `feat/…`, `fix/…`, `refactor/…`, `chore/…`.
- Commit messages: short imperative subject, optional body with rationale. Example:
  - `feat: add academic search provider adapter`
  - `fix: handle empty search results from Crossref`
- Use the monorepo package scope when relevant: packages are under `packages/` and published as `@foxxytux/*`.
- Run the repository checks and local CLI before pushing (see Commands).

## Communication
- Use GitHub issues & PRs for design discussion and review.
- Mention reviewers in PRs and include testing steps and any required environment variables.
- For synchronous discussion, the repo integrates with Slack (see `packages/mom` — Slack bot). Share PR/issue links there if configured.
- Keep PR descriptions concise and include:
  - purpose and context
  - key files changed
  - how to run / verify locally
  - any migration or env var notes

## Tests / Verification
- Core repo check (lint + basic validations):
  - npm install
  - npm run check
- Local test scripts (repo root includes convenience scripts):
  - ./test.sh
  - ./pi-test.sh
  - ./buddy-test.sh (fast dev CLI, see Running the project)
- Per-package tests: from repo root you can run a workspace command:
  - npm -w packages/<package-name> test
  - Example: `npm -w packages/coding-agent test`
- CI: ensure your branch passes CI checks (lint, tests, typechecks) before requesting review.

## Running the project
Quickstart (local dev)
- Clone and install:
  - git clone <your-repo-url> buddy
  - cd buddy
  - npm install
- Run repository checks:
  - npm run check
- Start the fast dev CLI (dev-time wrapper included):
  - ./buddy-test.sh

Global CLI install (if you want the global metapackage):
- npm i -g @foxxytux/buddy

Per-package development
- To run or build an individual package:
  - cd packages/<package-name>
  - npm install
  - npm run <script> (common scripts: test, build, dev — check package.json)
- Or from repo root using npm workspaces:
  - npm -w packages/<package-name> run <script>

Environment variables commonly used (optional):
- TAVILY_API_KEY
- SERPER_API_KEY
- SERPAPI_API_KEY
- SCHOLA
Set these in your shell or a local .env when testing provider integrations.

## Common commands
From repository root:
- Install dependencies
  - npm install
- Repo checks
  - npm run check
- Fast dev CLI
  - ./buddy-test.sh
- Run root test script(s)
  - ./test.sh
  - ./pi-test.sh
- Run a package script using npm workspaces
  - npm -w packages/coding-agent run <script>
- Global install of metapackage (optional)
  - npm i -g @foxxytux/buddy
- Show top-level files (helpful for quick inspection)
  - ls -la

If you need to build/publish packages, run the relevant per-package build or use your normal monorepo release tooling. Check `packages/*/package.json` for package-specific scripts.

## Releases
- Use the root release script for lockstep releases:
  - `npm run release:patch`
  - `npm run release:minor`
  - `npm run release:major`
- The release script bumps versions, updates changelogs, commits, tags, and publishes to npm.
- GitHub Actions now creates the GitHub Release automatically for each pushed `v*` tag.
- If a release tag already exists on GitHub and needs to be re-fired, delete and re-push the tag instead of creating a second version.
- For the current `v4.1.18` release, the repo already has the tag and the workflow should publish the GitHub Release from that tag event.

## Conventions
- Language and tooling:
  - TypeScript monorepo (see `tsconfig.json` and `tsconfig.base.json`)
  - Husky hooks are enabled — commits/pre-push may run checks
  - Follow existing code style in `packages/tui` and `packages/coding-agent`
- Package naming: `@foxxytux/<name>`; keep public surface stable where possible.
- Docs: update `README.md`, `CONTRIBUTING.md`, and package-level README files for any user-visible change.
- Top-level scripts and files you may use:
  - `buddy-test.sh` — fast dev CLI wrapper
  - `test.sh`, `pi-test.sh` — test helpers
  - `npm run check` — canonical repository check script
- Be explicit about required environment variables in PRs and documentation when a change introduces new external integrations.

If you are unsure about a release or public API change, discuss it in an issue or PR before landing wide-reaching changes.
