/**
 * Aery Auto-Compact Extension
 *
 * Adds warning + circuit breaker on top of Aery's built-in compaction.
 * Aery already auto-compacts — this adds:
 * - Warning at contextWindow - 20,000 tokens
 * - Circuit breaker: stop after 3 consecutive failures
 * - Env overrides: AERY_AUTO_COMPACT_WINDOW, AERY_AUTOCOMPACT_PCT_OVERRIDE
 */

import type { ExtensionAPI } from "@eminent337/aery";

const WARN_BUFFER = 20_000;
const COMPACT_BUFFER = 13_000;
const MAX_FAILURES = 3;

export default function (pi: ExtensionAPI) {
	let failures = 0;
	let warned = false;

	pi.on("turn_end", async (_event, ctx) => {
		const usage = ctx.getContextUsage();
		if (!usage?.tokens || !usage.contextWindow) return;

		const windowOverride = parseInt(process.env.AERY_AUTO_COMPACT_WINDOW ?? "0");
		const pctOverride = parseFloat(process.env.AERY_AUTOCOMPACT_PCT_OVERRIDE ?? "0");
		const effectiveWindow = windowOverride || usage.contextWindow;
		const compactThreshold = pctOverride ? effectiveWindow * (1 - pctOverride) : COMPACT_BUFFER;
		const remaining = effectiveWindow - usage.tokens;

		if (!warned && remaining < WARN_BUFFER) {
			ctx.ui.notify(`Context at ${usage.percent?.toFixed(0)}% — will compact soon`, "warning");
			warned = true;
		}

		if (failures >= MAX_FAILURES) return;

		if (remaining < compactThreshold) {
			try {
				ctx.compact({ customInstructions: "Preserve all file paths, modified files, and current task state." });
				failures = 0;
				warned = false;
			} catch {
				failures++;
				if (failures >= MAX_FAILURES) {
					ctx.ui.notify("Auto-compact failed 3 times. Run /compact manually.", "error");
				}
			}
		}
	});
}
