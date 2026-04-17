# Buddy — research-focused interactive coding agent

Buddy is a research-first interactive coding assistant implemented as a set of packages and CLI tools under the @foxxytux scope. It provides a fast-start CLI, toolkit extensions for document and data workflows, and integrations for multiple LLM providers.

Buddy is based on and forked from the "pi" coding agent project; it diverges intentionally with different defaults, themes, and tooling focused on research workflows.

Install (single-package global CLI)

A single metapackage is available that installs the Buddy CLI and its runtime dependencies. Install the metapackage globally:

```bash
npm i -g @foxxytux/buddy
```

Quickstart (local development)

- Clone or use your local copy:

  git clone <your-repo-url> buddy
  cd buddy

- Install dependencies from the repo root:

  npm install

- Run repository checks:

  npm run check

- Start the fast dev CLI:

  ./buddy-test.sh

Repository layout (high level)

- packages/agent — @foxxytux/buddy-agent-core: core agent runtime and transports
- packages/ai — @foxxytux/buddy-ai: unified LLM provider layer
- packages/buddy — @foxxytux/buddy: metapackage and CLI wrapper
- packages/coding-agent — @foxxytux/buddy-coding-agent: main CLI and runtime for Buddy
- packages/mom — @foxxytux/buddy-mom: Slack bot integration
- packages/pods — @foxxytux/buddy-pods: vLLM / deployment helper CLI
- packages/tui — @foxxytux/buddy-tui: terminal UI components

Key features

- Fast startup and interactive CLI for research workflows
- Academic search (Crossref) and multiple web search backends
- Toolkit tools: plotting, data summarization, table formatting, document export, image/mindmap generation, entity extraction, todo/plan management
- ASCII previews for charts, tables, and mindmaps
- DOCX/PDF export with pandoc preferred and pure-TS fallback

Configuration

- Environment variables for search providers and keys (optional):
  - TAVILY_API_KEY
  - SERPER_API_KEY
  - SERPAPI_API_KEY
  - SCHOLAR_API_KEY

- Interactive configuration is available via the `/buddy-setup-search` extension command; keys persist to `~/.buddy/agent/auth.json`.

## Syncing with Upstream (pi-mono)

Because Buddy is a fork, you can pull in upstream changes without losing your custom branding and features:

```bash
# 1. Run the sync script (fetches upstream, creates a backup branch, and rebases Buddy changes)
npm run sync:upstream

# 2. If there are merge conflicts, resolve them, then:
git add <resolved-files>
git rebase --continue

# 3. Fast-forward main to the new sync branch
git switch main
git merge --ff-only sync/main-<timestamp>

# 4. Run checks to ensure everything works
npm run check

# 5. Push updated code to your GitHub repo
git push origin HEAD
```

See [docs/upstream-sync.md](docs/upstream-sync.md) for full details.

## Publishing to npm

Releasing all packages in lockstep:

```bash
# 1. Ensure you are logged in to npm with access to @foxxytux
export NPM_TOKEN="your_automation_token"

# 2. Run the release script (bumps version, updates changelogs, tags, and publishes)
npm run release:patch    # for bug fixes
# OR
npm run release:minor    # for new features

# 3. Push the new tags to GitHub
git push origin --tags
```

Developer notes

- Build and publish are driven from the monorepo root. The `publish` script calls `npm publish -ws` and publishes workspace packages by their package.json `name` fields.
- Use `npm run check` before committing. See CONTRIBUTING.md for contributor rules.

Troubleshooting

- Ensure `pandoc` and `pdftotext` are available on the PATH for full doc and PDF handling; Buddy will fall back when missing.
- Create output directories (e.g., `mkdir -p reports`) before invoking tools that write files.

License

MIT