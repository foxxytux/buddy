import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	type ExtensionAPI,
	truncateHead,
} from "@mariozechner/buddy-coding-agent";
import { StringEnum, Type } from "@mariozechner/buddy-ai";

const execFile = promisify(execFileCallback);

const DEFAULT_DOC_ROOT = "docs";
const DEFAULT_DOC_EXTENSIONS = [".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".yaml", ".yml", ".pdf"] as const;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_CONTEXT_LINES = 2;
const DEFAULT_SEARCH_PROVIDER_ORDER: SearchProvider[] = ["tavily", "serper", "serpapi"];

const docListTool = defineTool({
	name: "doc_list",
	label: "Doc List",
	description: "List document files under a directory relative to the workspace. Defaults to docs/.",
	promptSnippet: "List available documents before reading or searching when the document structure is unknown.",
	promptGuidelines: [
		"Use this before doc_read or doc_search when you need to discover document files.",
		"Prefer narrow paths such as docs/api or knowledge/handbook over scanning the full repository.",
	],
	parameters: Type.Object({
		path: Type.Optional(Type.String({ description: "Relative directory to scan. Defaults to docs." })),
		limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: DEFAULT_MAX_RESULTS })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const root = await resolveExistingPath(ctx.cwd, params.path ?? DEFAULT_DOC_ROOT, true);
		const limit = params.limit ?? DEFAULT_MAX_RESULTS;
		const files = await collectDocumentFiles(root.absolutePath, limit);
		const text =
			files.length === 0
				? `No document files found under ${root.relativePath}.`
				: files.map((file, index) => `${index + 1}. ${relative(ctx.cwd, file)}`).join("\n");
		return {
			content: [{ type: "text", text }],
			details: {
				path: root.relativePath,
				count: files.length,
			},
		};
	},
});

const docReadTool = defineTool({
	name: "doc_read",
	label: "Doc Read",
	description: `Read a workspace document file. PDF files are extracted through pdftotext. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES} bytes.`,
	promptSnippet: "Read the contents of a document file inside the workspace.",
	promptGuidelines: [
		"Use doc_list first if the target path is uncertain.",
		"Prefer doc_retrieve for evidence-oriented queries where citations matter.",
	],
	parameters: Type.Object({
		path: Type.String({ description: "Relative file path to read, for example docs/architecture.md." }),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const file = await resolveExistingPath(ctx.cwd, params.path, false);
		const content = file.relativePath.endsWith(".pdf")
			? await extractPdfTextFromFile(file.absolutePath)
			: await readFile(file.absolutePath, "utf8");
		const truncated = truncateHead(content, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
		let text = truncated.content;
		if (truncated.truncated) {
			text += `\n\n[Truncated: showing ${truncated.outputLines} of ${truncated.totalLines} lines, ${truncated.outputBytes} of ${truncated.totalBytes} bytes.]`;
		}
		return {
			content: [{ type: "text", text }],
			details: {
				path: file.relativePath,
				truncated: truncated.truncated,
			},
		};
	},
});

const docSearchTool = defineTool({
	name: "doc_search",
	label: "Doc Search",
	description: "Search document files with ripgrep under a workspace directory. Defaults to docs/.",
	promptSnippet: "Search the local document corpus for keywords or exact phrases.",
	promptGuidelines: [
		"Use short exact phrases first, then broaden the query if needed.",
		"Search a focused subdirectory when possible to reduce noise.",
	],
	parameters: Type.Object({
		query: Type.String({ description: "Search text or regex for ripgrep." }),
		path: Type.Optional(Type.String({ description: "Relative directory or file to search. Defaults to docs." })),
		glob: Type.Optional(Type.String({ description: "Optional ripgrep glob such as *.md" })),
		limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: DEFAULT_MAX_RESULTS })),
		caseSensitive: Type.Optional(Type.Boolean({ default: false })),
		mode: Type.Optional(StringEnum(["regex", "literal"], { default: "literal" })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const root = await resolveExistingPath(ctx.cwd, params.path ?? DEFAULT_DOC_ROOT, undefined);
		const args = buildRipgrepArgs({
			query: params.query,
			limit: params.limit ?? DEFAULT_MAX_RESULTS,
			glob: params.glob,
			caseSensitive: params.caseSensitive ?? false,
			mode: params.mode ?? "literal",
			targetPath: root.absolutePath,
		});

		try {
			const { stdout } = await execFile("rg", args, {
				cwd: ctx.cwd,
				encoding: "utf8",
				maxBuffer: 1024 * 1024,
			});
			const truncated = truncateHead(stdout.trim(), { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
			let text = truncated.content || "No matches found.";
			if (truncated.truncated) {
				text += `\n\n[Truncated search results at ${truncated.outputLines} lines.]`;
			}
			return {
				content: [{ type: "text", text }],
				details: {
					path: root.relativePath,
					query: params.query,
					glob: params.glob,
					mode: params.mode ?? "literal",
				},
			};
		} catch (error) {
			if (isExecError(error) && error.code === 1) {
				return {
					content: [{ type: "text", text: `No matches found for "${params.query}" under ${root.relativePath}.` }],
					details: {
						path: root.relativePath,
						query: params.query,
						glob: params.glob,
						mode: params.mode ?? "literal",
					},
				};
			}
			throw error;
		}
	},
});

const docRetrieveTool = defineTool({
	name: "doc_retrieve",
	label: "Doc Retrieve",
	description:
		"Retrieve contextual local-document snippets with file and line citations using ripgrep context windows. Use this when you need evidence, not just file names.",
	promptSnippet: "Retrieve local evidence snippets with path and line citations before answering from documents.",
	promptGuidelines: [
		"Prefer this over doc_read when answering a focused question from a large corpus.",
		"Quote the cited file paths and line numbers in your answer when they support a claim.",
	],
	parameters: Type.Object({
		query: Type.String({ description: "Text or regex to retrieve around." }),
		path: Type.Optional(Type.String({ description: "Relative directory or file to search. Defaults to docs." })),
		glob: Type.Optional(Type.String({ description: "Optional ripgrep glob such as *.md" })),
		maxSnippets: Type.Optional(Type.Number({ minimum: 1, maximum: 20, default: 8 })),
		contextLines: Type.Optional(Type.Number({ minimum: 0, maximum: 8, default: DEFAULT_CONTEXT_LINES })),
		caseSensitive: Type.Optional(Type.Boolean({ default: false })),
		mode: Type.Optional(StringEnum(["regex", "literal"], { default: "literal" })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const root = await resolveExistingPath(ctx.cwd, params.path ?? DEFAULT_DOC_ROOT, undefined);
		const args = buildRipgrepArgs({
			query: params.query,
			limit: params.maxSnippets ?? 8,
			glob: params.glob,
			caseSensitive: params.caseSensitive ?? false,
			mode: params.mode ?? "literal",
			targetPath: root.absolutePath,
			contextLines: params.contextLines ?? DEFAULT_CONTEXT_LINES,
		});

		try {
			const { stdout } = await execFile("rg", args, {
				cwd: ctx.cwd,
				encoding: "utf8",
				maxBuffer: 1024 * 1024,
			});
			const blocks = splitRipgrepBlocks(stdout)
				.slice(0, params.maxSnippets ?? 8)
				.map((block, index) => `Snippet ${index + 1}\n${block}`);
			const body = blocks.join("\n\n") || "No contextual snippets found.";
			const truncated = truncateHead(body, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
			let text = truncated.content;
			if (truncated.truncated) {
				text += `\n\n[Truncated retrieval output at ${truncated.outputLines} lines.]`;
			}
			return {
				content: [{ type: "text", text }],
				details: {
					path: root.relativePath,
					query: params.query,
					snippets: blocks.length,
				},
			};
		} catch (error) {
			if (isExecError(error) && error.code === 1) {
				return {
					content: [{ type: "text", text: `No contextual snippets found for "${params.query}" under ${root.relativePath}.` }],
					details: {
						path: root.relativePath,
						query: params.query,
						snippets: 0,
					},
				};
			}
			throw error;
		}
	},
});

const webSearchTool = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the web using Tavily, Serper, or SerpAPI. Choose a provider explicitly or use auto to pick the first configured provider.",
	promptSnippet: "Search the web for current information when local documents are insufficient.",
	promptGuidelines: [
		"Prefer local docs first for repository-specific answers.",
		"Set provider explicitly when the user asks for a specific search backend.",
	],
	parameters: Type.Object({
		query: Type.String({ description: "Search query." }),
		provider: Type.Optional(StringEnum(["auto", "tavily", "serper", "serpapi"], { default: "auto" })),
		searchDepth: Type.Optional(StringEnum(["basic", "advanced"], { default: "basic" })),
		maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 10, default: 5 })),
	}),
	async execute(_toolCallId, params) {
		const provider = pickSearchProvider(params.provider ?? "auto");
		if (!provider) {
			return {
				content: [
					{
						type: "text",
						text: "web_search is not configured. Set one of TAVILY_API_KEY, SERPER_API_KEY, or SERPAPI_API_KEY.",
					},
				],
				details: {
					configured: false,
					availableProviders: getConfiguredProviders(),
				},
				isError: true,
			};
		}

		const result = await runWebSearch(provider, params.query, params.maxResults ?? 5, params.searchDepth ?? "basic");
		const lines: string[] = [`Provider: ${provider}`];
		if (result.answer) {
			lines.push(`Answer: ${result.answer}`);
			lines.push("");
		}
		for (const [index, item] of result.results.entries()) {
			lines.push(`${index + 1}. ${item.title}`);
			lines.push(`   URL: ${item.url}`);
			if (item.snippet) {
				lines.push(`   ${item.snippet}`);
			}
		}

		return {
			content: [{ type: "text", text: lines.join("\n").trim() || "No results returned." }],
			details: {
				configured: true,
				provider,
				resultCount: result.results.length,
			},
		};
	},
});

const webFetchTool = defineTool({
	name: "web_fetch",
	label: "Web Fetch",
	description:
		"Fetch a URL and return cleaned text. HTML is converted to text. PDF URLs are extracted through pdftotext. Useful after web_search to inspect a source directly.",
	promptSnippet: "Fetch and inspect a specific web page or PDF.",
	promptGuidelines: [
		"Fetch pages returned by web_search when the summary is not enough.",
		"Prefer specific URLs over broad homepages.",
	],
	parameters: Type.Object({
		url: Type.String({ description: "Absolute URL to fetch." }),
	}),
	async execute(_toolCallId, params) {
		const response = await fetch(params.url, {
			headers: {
				"User-Agent": "buddy-general-agent-extension/0.2",
			},
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch ${params.url}: ${response.status}`);
		}

		const contentType = response.headers.get("content-type") ?? "";
		const body = contentType.includes("application/pdf") || params.url.toLowerCase().endsWith(".pdf")
			? await extractPdfTextFromBuffer(await response.arrayBuffer())
			: contentType.includes("text/html")
				? htmlToText(await response.text())
				: await response.text();
		const truncated = truncateHead(body, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
		let text = truncated.content;
		if (truncated.truncated) {
			text += `\n\n[Truncated fetched content at ${truncated.outputLines} lines.]`;
		}

		return {
			content: [{ type: "text", text }],
			details: {
				url: params.url,
				contentType,
				truncated: truncated.truncated,
			},
		};
	},
});

const webCrawlTool = defineTool({
	name: "web_crawl",
	label: "Web Crawl",
	description:
		"Fetch a page, summarize its text, and extract links. Useful for discovering nearby pages before fetching a specific source.",
	promptSnippet: "Crawl a page to discover links and get a quick text summary.",
	promptGuidelines: [
		"Use this to discover documentation sections from an index page.",
		"Follow up with web_fetch on the exact URL you want to inspect.",
	],
	parameters: Type.Object({
		url: Type.String({ description: "Absolute URL to crawl." }),
		maxLinks: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10 })),
		sameDomainOnly: Type.Optional(Type.Boolean({ default: true })),
	}),
	async execute(_toolCallId, params) {
		const url = new URL(params.url);
		const response = await fetch(url, {
			headers: {
				"User-Agent": "buddy-general-agent-extension/0.2",
			},
		});
		if (!response.ok) {
			throw new Error(`Failed to crawl ${params.url}: ${response.status}`);
		}

		const html = await response.text();
		const summary = truncateHead(htmlToText(html), {
			maxBytes: DEFAULT_MAX_BYTES / 2,
			maxLines: Math.max(50, Math.floor(DEFAULT_MAX_LINES / 2)),
		}).content;
		const links = extractLinks(html, url, params.sameDomainOnly ?? true).slice(0, params.maxLinks ?? 10);

		const text = [
			`URL: ${url.toString()}`,
			"",
			"Summary:",
			summary || "[No text content extracted]",
			"",
			"Links:",
			...(links.length === 0 ? ["[No links found]"] : links.map((link, index) => `${index + 1}. ${link}`)),
		].join("\n");

		return {
			content: [{ type: "text", text }],
			details: {
				url: params.url,
				linkCount: links.length,
			},
		};
	},
});

const pdfExtractTool = defineTool({
	name: "pdf_extract",
	label: "PDF Extract",
	description:
		"Extract text from a local PDF path or remote PDF URL using pdftotext. Use for manuals, specs, or reference documents not stored as Markdown.",
	promptSnippet: "Extract text from a PDF document.",
	promptGuidelines: [
		"Prefer a local workspace PDF path when available.",
		"Use web_fetch for non-PDF web pages and pdf_extract for PDFs.",
	],
	parameters: Type.Object({
		path: Type.Optional(Type.String({ description: "Relative workspace PDF path." })),
		url: Type.Optional(Type.String({ description: "Absolute PDF URL." })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		if (!params.path && !params.url) {
			return {
				content: [{ type: "text", text: "Provide either path or url." }],
				details: {},
				isError: true,
			};
		}
		if (params.path && params.url) {
			return {
				content: [{ type: "text", text: "Provide path or url, not both." }],
				details: {},
				isError: true,
			};
		}

		const text = params.path
			? await extractPdfTextFromFile((await resolveExistingPath(ctx.cwd, params.path, false)).absolutePath)
			: await extractPdfTextFromUrl(params.url ?? "");
		const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
		let body = truncated.content;
		if (truncated.truncated) {
			body += `\n\n[Truncated PDF text at ${truncated.outputLines} lines.]`;
		}

		return {
			content: [{ type: "text", text: body }],
			details: {
				source: params.path ?? params.url,
				truncated: truncated.truncated,
			},
		};
	},
});

export default function generalAgentExtension(pi: ExtensionAPI) {
	pi.registerTool(docListTool);
	pi.registerTool(docReadTool);
	pi.registerTool(docSearchTool);
	pi.registerTool(docRetrieveTool);
	pi.registerTool(webSearchTool);
	pi.registerTool(scholarSearchTool);
	pi.registerTool(webFetchTool);
	pi.registerTool(webCrawlTool);
	pi.registerTool(pdfExtractTool);

	pi.registerCommand("general-agent-help", {
		description: "Show the project-local general-agent extension setup notes.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[
					"Tools: doc_list, doc_read, doc_search, doc_retrieve, web_search, scholar_search, web_fetch, web_crawl, pdf_extract.",
					"Search providers: auto, tavily, serper, serpapi. Use scholar_search for Semantic Scholar academic searches.",
					"Env: TAVILY_API_KEY, SERPER_API_KEY, SERPAPI_API_KEY, SCHOLAR_API_KEY (optional).",
				].join(" "),
				"info",
			);
		},
	});

	// Persist detected plan steps as a session custom entry so buddy-toolkit can pick them up
	pi.on("agent_end", async (event, ctx) => {
		const messages = event.messages as any[];
		const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && Array.isArray(m.content));
		if (!lastAssistant) return;
		const text = extractTextContent(lastAssistant.content);
		const extracted = extractTodoItems(text);
		if (extracted.length === 0) return;
		// Convert to Buddy todo format
		const todos = extracted.map((it, i) => ({ id: i + 1, text: it.text, done: false }));
		pi.appendEntry("buddy-todos", { todos });
		if (ctx.hasUI) {
			ctx.ui.notify(`Detected ${todos.length} plan steps; saved as Buddy todos. Use /buddy-todos to view.`, "info");
		}
	});
}

type SearchProvider = "tavily" | "serper" | "serpapi";
type SearchMode = "regex" | "literal";
type SearchDepth = "basic" | "advanced";

interface ResolvedPath {
	absolutePath: string;
	relativePath: string;
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (typeof block !== "object" || block === null) return "";
			const b: any = block;
			return b.type === "text" && typeof b.text === "string" ? b.text : "";
		})
		.filter((t) => t.length > 0)
		.join("\n");
}

interface ExecError {
	code?: number;
}

interface SearchResultItem {
	title: string;
	url: string;
	snippet: string;
}

interface SearchResponse {
	answer?: string;
	results: SearchResultItem[];
}

interface TavilySearchResult {
	title?: string;
	url?: string;
	content?: string;
}

interface TavilySearchResponse {
	answer?: string;
	results?: TavilySearchResult[];
}

interface SerperOrganicResult {
	title?: string;
	link?: string;
	snippet?: string;
}

interface SerperSearchResponse {
	answerBox?: { answer?: string; snippet?: string };
	organic?: SerperOrganicResult[];
}

interface SerpApiOrganicResult {
	title?: string;
	link?: string;
	snippet?: string;
}

interface SerpApiSearchResponse {
	answer_box?: { answer?: string; snippet?: string };
	organic_results?: SerpApiOrganicResult[];
}

function isExecError(value: unknown): value is ExecError {
	return typeof value === "object" && value !== null && "code" in value;
}

async function resolveExistingPath(
	cwd: string,
	inputPath: string,
	requireDirectory: boolean | undefined,
): Promise<ResolvedPath> {
	const absolutePath = resolve(cwd, inputPath);
	assertInsideWorkspace(cwd, absolutePath);
	await access(absolutePath);
	const pathStats = await stat(absolutePath);
	if (requireDirectory === true && !pathStats.isDirectory()) {
		throw new Error(`${inputPath} is not a directory.`);
	}
	if (requireDirectory === false && !pathStats.isFile()) {
		throw new Error(`${inputPath} is not a file.`);
	}
	return {
		absolutePath,
		relativePath: relative(cwd, absolutePath) || ".",
	};
}

async function collectDocumentFiles(root: string, limit: number): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const results: string[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		const absolutePath = resolve(root, entry.name);
		if (entry.isDirectory()) {
			const nested = await collectDocumentFiles(absolutePath, limit - results.length);
			results.push(...nested);
		} else if (hasDocumentExtension(entry.name)) {
			results.push(absolutePath);
		}
		if (results.length >= limit) {
			break;
		}
	}
	return results;
}

function hasDocumentExtension(fileName: string): boolean {
	return DEFAULT_DOC_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

function assertInsideWorkspace(cwd: string, absolutePath: string): void {
	const workspace = resolve(cwd);
	if (absolutePath === workspace) {
		return;
	}
	if (!absolutePath.startsWith(`${workspace}${sep}`)) {
		throw new Error("Path must stay inside the workspace.");
	}
}

function buildRipgrepArgs(options: {
	query: string;
	limit: number;
	glob?: string;
	caseSensitive: boolean;
	mode: SearchMode;
	targetPath: string;
	contextLines?: number;
}): string[] {
	const args = ["--line-number", "--color=never", "--max-count", String(options.limit)];
	if (options.contextLines !== undefined) {
		args.push("--context", String(options.contextLines));
	}
	if (!options.caseSensitive) {
		args.push("-i");
	}
	if (options.mode === "literal") {
		args.push("-F");
	}
	if (options.glob) {
		args.push("--glob", options.glob);
	}
	args.push(options.query, options.targetPath);
	return args;
}

function splitRipgrepBlocks(output: string): string[] {
	return output
		.split(/\n--\n/g)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);
}

function pickSearchProvider(requested: "auto" | SearchProvider): SearchProvider | undefined {
	if (requested !== "auto") {
		return isProviderConfigured(requested) ? requested : undefined;
	}
	return DEFAULT_SEARCH_PROVIDER_ORDER.find((provider) => isProviderConfigured(provider));
}

function getConfiguredProviders(): SearchProvider[] {
	return DEFAULT_SEARCH_PROVIDER_ORDER.filter((provider) => isProviderConfigured(provider));
}

function isProviderConfigured(provider: SearchProvider): boolean {
	switch (provider) {
		case "tavily":
			return Boolean(process.env.TAVILY_API_KEY);
		case "serper":
			return Boolean(process.env.SERPER_API_KEY);
		case "serpapi":
			return Boolean(process.env.SERPAPI_API_KEY);
		case "scholar":
			// Semantic Scholar is publicly accessible without an API key for basic searches.
			// Treat as available by default; an optional SCHOLAR_API_KEY can be provided to increase rate limits.
			return true;
	}
}

async function runWebSearch(
	provider: SearchProvider,
	query: string,
	maxResults: number,
	searchDepth: SearchDepth,
): Promise<SearchResponse> {
	switch (provider) {
		case "tavily":
			return searchWithTavily(query, maxResults, searchDepth);
		case "serper":
			return searchWithSerper(query, maxResults);
		case "serpapi":
			return searchWithSerpApi(query, maxResults);
		}
}

const scholarSearchTool = defineTool({
	name: "scholar_search",
	label: "Scholar Search",
	description: "Search Semantic Scholar for academic papers. Returns title, URL, and short abstract snippet.",
	promptSnippet: "Search Semantic Scholar for academic papers when research requires scholarly sources.",
	parameters: Type.Object({
		query: Type.String({ description: "Search query." }),
		maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20, default: 5 })),
	}),
	async execute(_toolCallId, params) {
		const max = params.maxResults ?? 5;
		try {
			const result = await searchWithScholar(params.query, max);
			const lines: string[] = [`Provider: scholar`];
			for (const [index, item] of result.results.entries()) {
				lines.push(`${index + 1}. ${item.title}`);
				lines.push(`   URL: ${item.url}`);
				if (item.snippet) lines.push(`   ${item.snippet}`);
			}
			return {
				content: [{ type: "text", text: lines.join("\n").trim() || "No results returned." }],
				details: { configured: true, provider: "scholar", resultCount: result.results.length },
			};
		} catch (err: any) {
			if (err && err.status === 429) {
				return {
					content: [{ type: "text", text: "Semantic Scholar rate-limited (HTTP 429). Please retry later or provide a SCHOLAR_API_KEY via /buddy-setup-search to increase rate limits." }],
					details: { configured: false, provider: "scholar", error: "rate_limited" },
					isError: true,
				};
			}
			return {
				content: [{ type: "text", text: `Semantic Scholar search failed: ${formatError(err)}` }],
				details: { configured: false, provider: "scholar", error: err?.message ?? String(err) },
				isError: true,
			};
		}
	},
});

async function searchWithTavily(query: string, maxResults: number, searchDepth: SearchDepth): Promise<SearchResponse> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) {
		throw new Error("TAVILY_API_KEY is not configured.");
	}

	const response = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			api_key: apiKey,
			query,
			search_depth: searchDepth,
			max_results: maxResults,
			include_answer: true,
		}),
	});
	if (!response.ok) {
		throw new Error(`Tavily search failed with status ${response.status}`);
	}

	const payload = (await response.json()) as TavilySearchResponse;
	return {
		answer: payload.answer,
		results: (payload.results ?? []).slice(0, maxResults).map((result) => ({
			title: result.title ?? "Untitled",
			url: result.url ?? "",
			snippet: squashWhitespace(result.content ?? ""),
		})),
	};
}

async function searchWithSerper(query: string, maxResults: number): Promise<SearchResponse> {
	const apiKey = process.env.SERPER_API_KEY;
	if (!apiKey) {
		throw new Error("SERPER_API_KEY is not configured.");
	}

	const response = await fetch("https://google.serper.dev/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-API-KEY": apiKey,
		},
		body: JSON.stringify({
			q: query,
			num: maxResults,
		}),
	});
	if (!response.ok) {
		throw new Error(`Serper search failed with status ${response.status}`);
	}

	const payload = (await response.json()) as SerperSearchResponse;
	return {
		answer: payload.answerBox?.answer ?? payload.answerBox?.snippet,
		results: (payload.organic ?? []).slice(0, maxResults).map((result) => ({
			title: result.title ?? "Untitled",
			url: result.link ?? "",
			snippet: squashWhitespace(result.snippet ?? ""),
		})),
	};
}

async function searchWithSerpApi(query: string, maxResults: number): Promise<SearchResponse> {
	const apiKey = process.env.SERPAPI_API_KEY;
	if (!apiKey) {
		throw new Error("SERPAPI_API_KEY is not configured.");
	}

	const url = new URL("https://serpapi.com/search.json");
	url.searchParams.set("engine", "google");
	url.searchParams.set("q", query);
	url.searchParams.set("api_key", apiKey);
	url.searchParams.set("num", String(maxResults));

	const response = await fetch(url, {
		headers: {
			"User-Agent": "buddy-general-agent-extension/0.2",
		},
	});
	if (!response.ok) {
		throw new Error(`SerpAPI search failed with status ${response.status}`);
	}

	const payload = (await response.json()) as SerpApiSearchResponse;
	return {
		answer: payload.answer_box?.answer ?? payload.answer_box?.snippet,
		results: (payload.organic_results ?? []).slice(0, maxResults).map((result) => ({
			title: result.title ?? "Untitled",
			url: result.link ?? "",
			snippet: squashWhitespace(result.snippet ?? ""),
		})),
	};
}

async function searchWithScholar(query: string, maxResults: number): Promise<SearchResponse> {
	// Use Crossref works API as a Scholar backend (no API key required).
	const url = new URL("https://api.crossref.org/works");
	url.searchParams.set("query", query);
	url.searchParams.set("rows", String(maxResults));

	const response = await fetch(url.toString(), { headers: { "User-Agent": "buddy-general-agent-extension/0.2" } });
	if (!response.ok) {
		if (response.status === 429) {
			const err: any = new Error("Crossref rate limited (429)");
			err.status = 429;
			throw err;
		}
		throw new Error(`Crossref search failed with status ${response.status}`);
	}
	const payload = await response.json().catch(() => ({}));
	const items: any[] = payload?.message?.items ?? [];
	const results: SearchResultItem[] = items.slice(0, maxResults).map((item) => {
		const title = Array.isArray(item.title) ? item.title[0] : item.title || "Untitled";
		const doi = item.DOI;
		const urlStr = item.URL ?? (doi ? `https://doi.org/${doi}` : "");
		const container = Array.isArray(item["container-title"]) ? item["container-title"][0] : item["container-title"] || "";
		const year = item.issued?.["date-parts"]?.[0]?.[0] ?? item.created?.["date-parts"]?.[0]?.[0];
		const snippetParts: string[] = [];
		if (container) snippetParts.push(container);
		if (year) snippetParts.push(String(year));
		const snippet = snippetParts.join(" • ") || (item.subtitle ? (Array.isArray(item.subtitle) ? item.subtitle[0] : item.subtitle) : "");
		return { title, url: urlStr, snippet: squashWhitespace(String(snippet || "") ) };
	});
	return { answer: undefined, results };
}

function extractLinks(html: string, baseUrl: URL, sameDomainOnly: boolean): string[] {
	const hrefRegex = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
	const links = new Set<string>();
	for (const match of html.matchAll(hrefRegex)) {
		const href = match[1];
		if (!href) {
			continue;
		}
		try {
			const url = new URL(href, baseUrl);
			if (sameDomainOnly && url.hostname !== baseUrl.hostname) {
				continue;
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				continue;
			}
			links.add(url.toString());
		} catch {
			continue;
		}
	}
	return [...links];
}

// Simple plan extraction: look for a "Plan:" section and numbered steps
function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i, "")
		.replace(/\s+/g, " ")
		.trim();
	if (cleaned.length > 0) cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	if (cleaned.length > 120) cleaned = `${cleaned.slice(0, 117)}...`;
	return cleaned;
}

function extractTodoItems(message: string): { step: number; text: string; completed: boolean }[] {
	const items: { step: number; text: string; completed: boolean }[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2].trim().replace(/\*{1,2}$/, "").trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}


async function extractPdfTextFromUrl(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			"User-Agent": "buddy-general-agent-extension/0.2",
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch PDF ${url}: ${response.status}`);
	}
	return extractPdfTextFromBuffer(await response.arrayBuffer());
}

async function extractPdfTextFromBuffer(buffer: ArrayBuffer): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), "buddy-general-agent-pdf-"));
	const pdfPath = join(tempDir, "document.pdf");
	try {
		await writeFile(pdfPath, Buffer.from(buffer));
		return await extractPdfTextFromFile(pdfPath);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function extractPdfTextFromFile(pdfPath: string): Promise<string> {
	try {
		const { stdout } = await execFile("pdftotext", ["-layout", pdfPath, "-"], {
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		});
		return stdout.trim() || "[pdftotext returned no text]";
	} catch (error) {
		throw new Error(`pdftotext failed for ${pdfPath}: ${formatError(error)}`);
	}
}

function htmlToText(html: string): string {
	return squashWhitespace(
		html
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&#39;/gi, "'")
			.replace(/&quot;/gi, '"'),
	);
}

function squashWhitespace(value: string): string {
	return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
