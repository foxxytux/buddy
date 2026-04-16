# General Agent Extension

Project-local buddy extension for a more general-purpose agent.

Included tools:

- `doc_list`: list local document files under a workspace directory
- `doc_read`: read a document file with truncation, including local PDFs
- `doc_search`: search local docs with ripgrep
- `doc_retrieve`: retrieve contextual snippets with file and line citations
- `web_search`: provider-selectable search via `tavily`, `serper`, `serpapi`, or `auto`
- `web_fetch`: fetch and clean a specific URL or PDF
- `web_crawl`: fetch a page and extract nearby links
- `pdf_extract`: extract text from a local or remote PDF

Usage:

```bash
buddy
```

Then ask for:

- "List the docs under `docs/`"
- "Search the docs for authentication flow"
- "Read `docs/architecture.md`"
- "Retrieve citations for auth flow from local docs"
- "Search the web with provider `serper` for the latest Tavily API docs"
- "Crawl the docs home page and list useful links"
- "Extract text from `docs/spec.pdf`"

Optional setup:

```bash
export TAVILY_API_KEY=tvly-...
export SERPER_API_KEY=...
export SERPAPI_API_KEY=...
```

Notes:

- The document tools are constrained to the current workspace.
- `web_search` supports `provider: "auto" | "tavily" | "serper" | "serpapi"`.
- `doc_retrieve` is the better default when you want evidence with citations instead of full-file reads.
- PDF extraction uses the local `pdftotext` binary.
- Reload with `/reload` after editing the extension.
