/**
 * Notify on startup if there are open upstream sync conflict issues.
 * Checks GitHub once per day, shows a one-line notice if action needed.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const CACHE_PATH = join(homedir(), ".aery", "agent", "upstream-notify-cache.json");
const ONE_DAY = 86400000;

async function checkUpstreamIssues(): Promise<string | null> {
	try {
		const res = await fetch(
			"https://api.github.com/repos/eminent337/aery/issues?labels=upstream-sync&state=open&per_page=1",
			{ headers: { "User-Agent": "aery" } }
		);
		if (!res.ok) return null;
		const issues = await res.json() as any[];
		if (!issues.length) return null;
		// Only warn on actual conflicts/failures, not successful syncs
		const conflict = issues.find((i: any) =>
			i.title.includes("conflict") || i.title.includes("Manual") ||
			i.title.includes("failed") || i.title.includes("No auto-mergeable")
		);
		if (!conflict) return null;
		return `Upstream sync needs manual review: ${conflict.title} — ${conflict.html_url}`;
	} catch {
		return null;
	}
}

export default function (aery: ExtensionAPI) {
	aery.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		// Check at most once per day
		try {
			if (existsSync(CACHE_PATH)) {
				const cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
				if (Date.now() - cache.checkedAt < ONE_DAY) return;
			}
		} catch {}

		const msg = await checkUpstreamIssues();
		writeFileSync(CACHE_PATH, JSON.stringify({ checkedAt: Date.now() }));
		if (msg) ctx.ui.notify(msg, "warning");
	});
}
