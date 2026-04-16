# Buddy — research-focused interactive coding agent

Package: @foxxytux/buddy

This project is a fork and rebrand of the "pi" coding agent. It diverges intentionally: Buddy aims to provide a research-first interactive assistant with additional toolkit features, a different default theme, and distinct UX and persistence choices.

Buddy is a fast-starting interactive research and coding assistant built as a set of extensions for the Buddy coding-agent runtime. Buddy focuses on research workflows, long-running agent tasks (todos / plans), and a toolkit of utilities that return machine-readable results plus human-friendly ASCII previews.

---

## Key features

- Fast startup using `./buddy-test.sh` and lightweight extensions.
- Dedicated academic search tool (`scholar_search`) backed by Crossref (no API key required by default).
- General web search (`web_search`) with selectable providers: Tavily, Serper, SerpAPI.
- Persistent todo list and plan extraction for long-running agent workflows (`/buddy-todos`, `todo_update`).
- Toolkit with utilities: `plot`, `data_summarize`, `table_format`, `doc_export` (pandoc preferred, pure-TS fallback), `content_rewrite`, `cite_sources`, `image_gen`, `mindmap_gen`, `sentiment_analyze`, `entity_extract`, `todo_update`.
- ASCII previews: plots, tables, mindmaps, citations, todo lists.
- DOCX fallback using JSZip and a minimal PDF generator when `pandoc` is unavailable.
- A simple mascot widget and UI dialogs for common tasks and setup.

---

## Quickstart — run Buddy locally

1. Clone the repository (or use your local copy):

   git clone <your-repo-url> buddy
   cd buddy

2. Install dependencies from the repo root:

   npm install

3. Run lightweight checks:

   npm run check

4. Start Buddy (fast path):

   ./buddy-test.sh

Notes
- `buddy-test.sh` prefers the built CLI when available; otherwise it falls back to running via `tsx`.
- The script is optimized for quick iterations during development.

---

## Installation (package)

When published, the package name will be `@foxxytux/buddy`.

Install (global CLI):

- Recommended: `npm i -g @foxxytux/buddy`
- After installing globally, run the CLI with `buddy` (package `bin` configuration determines the command).

Local development:

- Install dependencies (repo root): `npm install`
- Run Buddy locally for development and testing: `./buddy-test.sh`

---

## Configuration

### Search providers and API keys
Buddy supports general web search providers and a separate academic search tool.

- Environment variables (optional):
  - `TAVILY_API_KEY`
  - `SERPER_API_KEY`
  - `SERPAPI_API_KEY`
  - `SCHOLAR_API_KEY` (optional; Crossref does not require a key; other providers may)

- Interactive setup: run the extension command:
  - `/buddy-setup-search` — choose a provider and optionally save an API key.
  - Keys are persisted to `~/.buddy/agent/auth.json` via the built-in AuthStorage.
  - On startup Buddy hydrates saved keys into `process.env` for the session.

### Where keys are stored
- `~/.buddy/agent/auth.json` (managed by the extension's AuthStorage helper).

---

## Core commands and widgets

- `/buddy-help` — show Buddy capabilities and quick notes.
- `/buddy-mascot` — show the Buddy mascot and tips.
- `/buddy-setup-search` — configure web search providers and API keys.
- `/buddy-summarize` — summarize the current conversation using the selected model.
- `/buddy-cite <url|path>` — quick citation formatter for URLs or workspace files.
- `/buddy-todos` — show the Buddy todo list for the current session branch.

---

## Toolkit tools (LLM-callable)

Tools are registered with the runtime and callable by LLMs when available in the toolset.

- web_search
  - General web search using Tavily, Serper, or SerpAPI.
  - Use `provider` param (or `auto`) to choose backend.

- scholar_search
  - Academic metadata search. Default backend: Crossref (`api.crossref.org/works`) — no API key required.
  - Returns title, DOI/URL, and a small snippet (journal/year).

- web_fetch
  - Fetch a URL and return cleaned text (HTML → text). PDFs use `pdftotext`.

- web_crawl
  - Crawl a page for summary and links.

- pdf_extract
  - Extract text from local or remote PDF using `pdftotext`.

- doc_list / doc_read / doc_search / doc_retrieve
  - Workspace document discovery and search (ripgrep required for `doc_search`/`doc_retrieve`).

- plot
  - Create line/bar/scatter SVG charts (saved to specified output path). Returns ASCII preview.

- data_summarize
  - Compute mean, median, stddev, trend; returns sparkline and ASCII summary.

- table_format
  - Convert JSON/CSV to Markdown or HTML and show ASCII preview.

- doc_export
  - Export Markdown to DOCX or PDF.
  - Prefers `pandoc` if available; falls back to a pure-TS DOCX generator (JSZip) or a minimal PDF generator.

- content_rewrite
  - Rewrite text for tone, brevity, or reading level (LLM-driven).

- cite_sources
  - Format source lists and return ASCII preview plus a saved output if requested.

- image_gen
  - Generate simple SVG visuals from text descriptions and return preview/paths.

- mindmap_gen
  - Generate Mermaid or DOT diagrams from `centralTopic` + `branchesJson` or from `text`.
  - Accepts `branchesJson` as an array of strings or objects — robust parsing.

- sentiment_analyze
  - Heuristic sentiment and bias meter (ASCII meter included).

- entity_extract
  - Extract names, dates, locations, URLs, and emails from text.

- todo_update
  - Stateful tool to maintain and persist a todo list across agent turns and branches.

---

## Long-running agent support (todos & plan extraction)

- Buddy detects `Plan:` sections in assistant messages and extracts numbered steps into a persisted session entry (`customType: buddy-todos`).
- The toolkit reconstructs todo state from tool-result messages or custom session entries.
- The agent and extensions can mark steps completed using `[DONE:n]` markers.
- Use `/buddy-todos` to inspect and manage plan steps.

---

## UI and appearance

- The interactive theme uses a high-contrast accent (reflector neon yellow) and clear borders on dialogs.
- Dialogs use `Container`, `DynamicBorder`, and `Text` components for consistent padding and framing.
- The mascot is an ASCII illustration placed in a bordered widget on session start.
- No global centering; default text rendering is left-aligned for compatibility.

---

## Troubleshooting and tips

- Plot tool `ENOENT` (missing output directory): create the output directory before calling the tool (e.g., `mkdir -p reports`). The tool writes files but does not create parent directories.
- Install `pdftotext` (poppler-utils or equivalent) for `pdf_extract` and PDF handling in `web_fetch`.
- `pandoc` is optional; if missing Buddy uses the built-in DOCX/PDF fallback.
- Rate limits: Crossref is generally friendly for light use; if you need a different academic backend (arXiv, Europe PMC, Semantic Scholar), tell me which provider and I will integrate it (Semantic Scholar previously caused 429s for heavy usage).
- Extension load errors: ensure extensions register handlers inside the exported factory (they must not reference `pi` at module top-level).

---

## Developer notes

- Repo layout of interest:
  - `.buddy/extensions` — Buddy-specific extensions and toolkit
  - `packages/coding-agent` — core runtime and extension APIs
  - `packages/tui` — terminal UI components

- Local checks and linting:
  - `npm run check` (runs biome / tsc / other checks configured in the repo)

- Tests and contributions:
  - Add focused tests under `packages/*/test` and run the specific test suites.
  - Keep changes minimal and run checks before committing.

---

## Examples

- Configure a provider interactively:
  - `/buddy-setup-search` → choose provider → supply key (optional) → save

- Scholar search (Crossref):
  - Tool: `scholar_search`
  - Params: `{ "query": "transformer neural networks 2020", "maxResults": 5 }`

- Generate a mindmap:
  - Tool: `mindmap_gen`
  - Params:
    ```json
    {
      "centralTopic": "Project X",
      "branchesJson": "[{\"name\":\"research\"},{\"name\":\"design\"},{\"name\":\"deploy\"}]",
      "format": "mermaid",
      "outputPath": "assets/project-x.mmd"
    }
    ```

- Export a Markdown file when `pandoc` is not installed:
  - Tool: `doc_export`
  - Params: `{ "path": "docs/notes.md", "format": "docx", "outputPath": "reports/notes.docx" }`

---

## License

Add your license here. This project is prepared to publish under the `@foxxytux/buddy` scope.

---

If you want this exact README committed to the repository (git add + commit + push) I can prepare the commit message. Otherwise the file has been created at `README.md` in the repo root.
