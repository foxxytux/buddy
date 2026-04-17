import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@foxxytux/buddy-coding-agent";

export default function (buddy: ExtensionAPI) {
	const logFile = join(process.cwd(), ".pi", "provider-payload.log");

	buddy.on("before_provider_request", (event) => {
		appendFileSync(logFile, `${JSON.stringify(event.payload, null, 2)}\n\n`, "utf8");

		// Optional: replace the payload instead of only logging it.
		// return { ...event.payload, temperature: 0 };
	});
}
