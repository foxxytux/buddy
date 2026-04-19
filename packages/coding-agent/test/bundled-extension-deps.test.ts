import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const codingAgentPackageDir = join(repoRoot, "packages", "coding-agent");
const extensionsDir = join(repoRoot, ".buddy", "extensions");

const BUILTIN_IMPORT_PREFIXES = ["node:", "@foxxytux/", "@sinclair/typebox"];

function collectExtensionEntryFiles(dir: string): string[] {
	return readdirSync(dir)
		.flatMap((entry) => {
			const entryPath = join(dir, entry);
			const stats = statSync(entryPath);
			if (stats.isDirectory()) {
				return ["index.ts", "index.js"]
					.map((name) => join(entryPath, name))
					.filter((candidate) => {
						try {
							return statSync(candidate).isFile();
						} catch {
							return false;
						}
					});
			}
			return entryPath.endsWith(".ts") || entryPath.endsWith(".js") ? [entryPath] : [];
		})
		.sort();
}

function collectBareImports(filePath: string): string[] {
	const source = readFileSync(filePath, "utf8");
	const matches = source.matchAll(/from\s+"([^"]+)"/g);
	const specifiers = new Set<string>();
	for (const match of matches) {
		const specifier = match[1];
		if (specifier.startsWith(".") || BUILTIN_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
			continue;
		}
		specifiers.add(specifier);
	}
	return [...specifiers];
}

describe("bundled extension runtime dependencies", () => {
	it("declares external bare imports used by shipped .buddy extensions", () => {
		const packageJson = JSON.parse(readFileSync(join(codingAgentPackageDir, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
		};
		const declaredDependencies = new Set(Object.keys(packageJson.dependencies ?? {}));

		const missingDependencies = collectExtensionEntryFiles(extensionsDir).flatMap((filePath) =>
			collectBareImports(filePath)
				.filter((specifier) => !declaredDependencies.has(specifier))
				.map((specifier) => `${specifier} (${filePath.replace(`${repoRoot}/`, "")})`),
		);

		expect(missingDependencies).toEqual([]);
	});
});
