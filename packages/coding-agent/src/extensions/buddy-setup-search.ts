import type { ExtensionAPI } from "@foxxytux/buddy-coding-agent";

// Minimal interactive setup for web/search provider API keys.
// Registers /buddy-setup-search command.

export default function buddySetupSearch(buddy: ExtensionAPI) {
	buddy.registerCommand("buddy-setup-search", {
		description: "Configure search provider API keys (SerpAPI, Serper, Tavily, Scholar)",
		handler: async (args: string, ctx) => {
			const providers = [
				{ id: "serpapi", label: "SerpAPI (SERPAPI_API_KEY)" },
				{ id: "serper", label: "Serper (SERPER_API_KEY)" },
				{ id: "tavily", label: "Tavily (TAVILY_API_KEY)" },
				{ id: "scholar", label: "Scholar (SCHOLAR_API_KEY)" },
			];

			// If user passed provider name as argument, try to match
			const arg = (args || "").trim().toLowerCase();
			let selectedId: string | undefined;
			if (arg) {
				const matched = providers.find((p) => p.id === arg || p.label.toLowerCase().includes(arg));
				if (matched) selectedId = matched.id;
			}

			let providerId: string | undefined = selectedId;

			if (!providerId) {
				const items = providers.map((p) => p.label);
				const pick = await ctx.ui.select("Select search provider to configure", items);
				if (!pick) return; // cancelled
				const picked = providers.find((p) => p.label === pick);
				if (!picked) return;
				providerId = picked.id;
			}

			// Offer actions: set/update key, show current, remove key
			const actions = ["Set / Update API key", "Show current key (masked)", "Remove key", "Cancel"];
			const action = await ctx.ui.select(`Configure ${providerId}`, actions);
			if (!action || action === "Cancel") return;

			const auth = ctx.modelRegistry.authStorage;

			if (action === "Set / Update API key") {
				const current = auth.get(providerId as any);
				const placeholder = current && current.type === "api_key" ? "(existing)" : "";
				const input = await ctx.ui.input(`Enter API key for ${providerId}`, placeholder);
				if (!input) {
					ctx.ui.notify("No key entered", "info");
					return;
				}
				// Persist to auth storage
				auth.set(providerId as any, { type: "api_key", key: input });
				// Refresh model registry so new auth is recognized immediately
				try {
					ctx.modelRegistry.refresh();
					ctx.ui.notify(`Saved API key for ${providerId}`, "info");
				} catch (err) {
					ctx.ui.notify(`Saved key but failed to refresh models: ${String(err)}`, "warning");
				}
				return;
			}

			if (action === "Show current key (masked)") {
				const entry = auth.get(providerId as any);
				if (!entry) {
					ctx.ui.notify("No key configured for " + providerId, "info");
					return;
				}
				if (entry.type === "api_key") {
					const k = entry.key;
					const masked = k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "(set)";
					ctx.ui.notify(`${providerId}: ${masked}`, "info");
					return;
				}
				if (entry.type === "oauth") {
					ctx.ui.notify(`${providerId}: logged in via OAuth (use /logout to clear)`, "info");
					return;
				}
			}

			if (action === "Remove key") {
				const ok = await ctx.ui.confirm("Remove API key", `Remove stored key for ${providerId}?`);
				if (!ok) return;
				auth.remove(providerId as any);
				try {
					ctx.modelRegistry.refresh();
					ctx.ui.notify(`Removed API key for ${providerId}`, "info");
				} catch (err) {
					ctx.ui.notify(`Removed key but failed to refresh models: ${String(err)}`, "warning");
				}
				return;
			}
		},
	});
}
