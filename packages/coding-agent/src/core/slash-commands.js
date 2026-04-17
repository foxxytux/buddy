// Auto-generated JS companion for TypeScript types in slash-commands.ts
// Provides runtime exports and JSDoc typedefs so TypeScript can import types

/**
 * @typedef {'extension'|'prompt'|'skill'} SlashCommandSource
 */

/**
 * @typedef {Object} SlashCommandInfo
 * @property {string} name
 * @property {string} [description]
 * @property {SlashCommandSource} source
 * @property {import("./source-info.js").SourceInfo} sourceInfo
 */

/**
 * @typedef {Object} BuiltinSlashCommand
 * @property {string} name
 * @property {string} description
 */

/** @type {ReadonlyArray<BuiltinSlashCommand>} */
export const BUILTIN_SLASH_COMMANDS = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous message" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Login with OAuth provider" },
	{ name: "logout", description: "Logout from OAuth provider" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ name: "quit", description: "Quit Buddy" },
];

// Also export an empty marker for potential future runtime helpers
export default {
	BUILTIN_SLASH_COMMANDS,
};
