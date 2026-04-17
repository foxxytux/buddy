import { basename, resolve } from "node:path";
import {
	AuthStorage,
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@foxxytux/buddy-coding-agent";
import { complete, getModel, type Model, type Api } from "@foxxytux/buddy-ai";
import { Container, Text, matchesKey } from "@foxxytux/buddy-tui";

interface TextBlock {
	type?: string;
	text?: string;
}

const SEARCH_PROVIDER_ENV: Record<"tavily" | "serper" | "serpapi" | "scholar", string> = {
	tavily: "TAVILY_API_KEY",
	serper: "SERPER_API_KEY",
	serpapi: "SERPAPI_API_KEY",
	scholar: "SCHOLAR_API_KEY",
};

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			const textBlock = block as TextBlock;
			return textBlock.type === "text" && typeof textBlock.text === "string" ? textBlock.text : "";
		})
		.filter((text) => text.length > 0)
		.join("\n");
}

async function configureSearchProvider(
	ctx: Pick<ExtensionContext, "hasUI" | "ui"> | Pick<ExtensionCommandContext, "hasUI" | "ui">,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Run this command in interactive mode to configure search provider.", "info");
		return;
	}

	const provider = await ctx.ui.select("Choose search provider", ["tavily", "serper", "serpapi", "scholar"]);
	if (!provider) return;
	const normalizedProvider = provider as keyof typeof SEARCH_PROVIDER_ENV;
	if (normalizedProvider === "scholar") {
		const wantsKey = await ctx.ui.confirm(
			"Semantic Scholar API key?",
			"Semantic Scholar is usable without an API key for basic searches. Do you want to enter an API key to increase rate limits?",
		);
		if (!wantsKey) {
			ctx.ui.notify("Configured Semantic Scholar without API key for this session.", "info");
			return;
		}
		const apiKey = await ctx.ui.input(`Enter API key for ${normalizedProvider} (stored in auth.json)`);
		if (!apiKey?.trim()) {
			ctx.ui.notify("No API key provided; configuration cancelled.", "warning");
			return;
		}
		const save = await ctx.ui.confirm(
			"Save API key to auth.json?",
			`This saves ${normalizedProvider} to ~/.buddy/agent/auth.json and enables web_search in future sessions.`,
		);
		if (save) {
			const storage = AuthStorage.create();
			storage.set(normalizedProvider, { type: "api_key", key: apiKey.trim() });
		}
		process.env[SEARCH_PROVIDER_ENV[normalizedProvider]] = apiKey.trim();
		ctx.ui.notify(`Configured ${normalizedProvider} for this session${save ? " and saved to auth.json" : ""}.`, "info");
		return;
	}

	const apiKey = await ctx.ui.input(`Enter API key for ${normalizedProvider} (stored in auth.json)`);
	if (!apiKey?.trim()) {
		ctx.ui.notify("No API key provided; configuration cancelled.", "warning");
		return;
	}

	const save = await ctx.ui.confirm(
		"Save API key to auth.json?",
		`This saves ${normalizedProvider} to ~/.buddy/agent/auth.json and enables web_search in future sessions.`,
	);

	if (save) {
		const storage = AuthStorage.create();
		storage.set(normalizedProvider, { type: "api_key", key: apiKey.trim() });
	}
	process.env[SEARCH_PROVIDER_ENV[normalizedProvider]] = apiKey.trim();
	ctx.ui.notify(`Configured ${normalizedProvider} for this session${save ? " and saved to auth.json" : ""}.`, "info");
}

async function hydrateSearchProviderEnv(): Promise<void> {
	const storage = AuthStorage.create();
	for (const [provider, envVar] of Object.entries(SEARCH_PROVIDER_ENV) as Array<[
		keyof typeof SEARCH_PROVIDER_ENV,
		string,
	]>) {
		if (process.env[envVar]) continue;
		const apiKey = await storage.getApiKey(provider);
		if (apiKey) {
			process.env[envVar] = apiKey;
		}
	}
}

async function summarizeConversation(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const conversation = ctx.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "message" && (entry.message?.role === "user" || entry.message?.role === "assistant"))
		.map((entry) => {
			const role = entry.message?.role === "user" ? "User" : "Assistant";
			const text = extractTextContent(entry.message?.content);
			return `${role}: ${text}`;
		})
		.filter((text) => text.trim().length > 0)
		.join("\n\n");

	if (!conversation.trim()) {
		return undefined;
	}

	const model: Model<Api> | undefined = ctx.model ?? getModel("openai", "gpt-4o") ?? getModel("openai", "gpt-4");
	if (!model) {
		ctx.ui.notify("No suitable model available. Set an API key or add a model.", "warning");
		return undefined;
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		ctx.ui.notify("No API key available for the selected model.", "warning");
		return undefined;
	}

	const prompt = [
		"Summarize this conversation with goals, decisions, progress, blockers, and next steps.",
		"Be concise and structured.",
		"<conversation>",
		conversation,
		"</conversation>",
	].join("\n");

	const response = await complete(
		model,
		{ messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] },
		{ apiKey: auth.apiKey, headers: auth.headers },
	);
	return response.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

export default function buddyExtension(buddy: ExtensionAPI) {
	buddy.registerCommand("buddy-help", {
		description: "Show Buddy capabilities and setup notes.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				"Buddy: research + document assistant. Core tools: doc_*, web_*, pdf_extract. Advanced tools: plot, data_summarize, table_format, doc_export, content_rewrite, cite_sources, image_gen, mindmap_gen, sentiment_analyze, entity_extract, todo_update. Commands: /buddy-mascot, /buddy-setup-search, /buddy-summarize, /buddy-cite, /buddy-todos.",
				"info",
			);
		},
	});

	buddy.registerCommand("buddy-mascot", {
		description: "Show Buddy mascot and quick tips.",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("(•ᴥ•) Buddy ready. Use /buddy-help for commands.", "info");
				return;
			}

			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(
					new Text(
						theme.fg("accent", "  /\_/\  \n ( o.o ) Buddy\n  > ^ < \n\n") +
						"Hi! I'm Buddy — your friendly research companion.\n\n" +
						"• Use web_search for live research.\n" +
						"• Use plot, table_format, and data_summarize for datasets.\n" +
						"• Use mindmap_gen and image_gen for visuals.\n" +
						"• Use todo_update to keep long agent loops organized.",
						1,
						1,
					),
				);
				container.addChild(new DynamicBorder((s: string) => theme.fg("muted", s)));
				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
							done(undefined);
						}
					},
				};
			});
		},
	});

	buddy.registerCommand("buddy-summarize", {
		description: "Summarize the current conversation.",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify("Preparing summary...", "info");
			const summary = await summarizeConversation(ctx);
			if (!summary) {
				ctx.ui.notify("No conversation text found.", "warning");
				return;
			}
			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Summary")) + "\n\n" + summary, 1, 1));
				container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
				container.addChild(new DynamicBorder((s: string) => theme.fg("muted", s)));
				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
							done(undefined);
						}
					},
				};
			});
		},
	});

	buddy.registerCommand("buddy-cite", {
		description: "Format a quick citation for a URL or workspace file.",
		handler: async (args, ctx) => {
			const target = args[0]?.trim();
			if (!target) {
				ctx.ui.notify("Provide a URL or relative file path: /buddy-cite <url|path>", "warning");
				return;
			}

			let citation = target;
			try {
				if (target.startsWith("http://") || target.startsWith("https://")) {
					const response = await fetch(target, { headers: { "User-Agent": "buddy-agent/0.1" } });
					const html = await response.text();
					const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
					const title = titleMatch?.[1]?.trim() || target;
					citation = `${title} (${new Date().toISOString().slice(0, 10)}) <${target}>`;
				} else {
					const absolutePath = resolve(ctx.cwd, target);
					citation = `${basename(absolutePath)} — ${absolutePath}`;
				}
			} catch {
				citation = target;
			}

			ctx.ui.notify(`Citation: ${citation}`, "info");
		},
	});

	buddy.registerCommand("buddy-setup-search", {
		description: "Configure web search provider and API key for Buddy.",
		handler: async (_args, ctx) => {
			await configureSearchProvider(ctx);
		},
	});

	buddy.on("session_start", async (_event, ctx) => {
		await hydrateSearchProviderEnv();
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("buddy-mascot", (_tui, theme) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", "(•ᴥ•) Buddy"), 1, 0));
			container.addChild(new Text(theme.fg("dim", "Type /buddy-help for tips"), 1, 0));
			return container;
		});

		const hasSearchProvider = Object.values(SEARCH_PROVIDER_ENV).some((envVar) => Boolean(process.env[envVar]));
		if (!hasSearchProvider) {
			const shouldConfigure = await ctx.ui.confirm(
				"Configure web search?",
				"Buddy can use Tavily, Serper, SerpAPI, or Scholar API for academic searches. Set one up now?",
			);
			if (shouldConfigure) {
				await configureSearchProvider(ctx);
			} else {
				ctx.ui.notify("Web search is not configured. Run /buddy-setup-search any time to enable it.", "info");
			}
		}
	});
}
