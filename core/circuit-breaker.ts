/**
 * Aery Circuit Breaker
 * Stops the agent if the same tool fails 3x in a row.
 * Prevents infinite error loops burning tokens.
 */

import type { ExtensionAPI } from "@eminent337/aery";

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_TOOL_RESULT_CHARS = 20_000; // ~5K tokens

export default function (aery: ExtensionAPI) {
	// Track consecutive failures per tool
	const failures = new Map<string, number>();

	aery.on("before_agent_start", async () => {
		failures.clear(); // reset on new user message
	});

	aery.on("tool_result", async (event, ctx) => {
		const toolName = event.toolName ?? "unknown";
		const isError = (event as any).isError || (event as any).result?.isError;

		// Warn on oversized tool results that could overflow context
		const resultStr = JSON.stringify((event as any).result ?? "");
		if (resultStr.length > MAX_TOOL_RESULT_CHARS) {
			ctx.ui.notify(
				`Large tool result: ${toolName} returned ${Math.round(resultStr.length / 1000)}KB — context may fill up`,
				"warning"
			);
		}

		if (isError) {
			const count = (failures.get(toolName) ?? 0) + 1;
			failures.set(toolName, count);

			if (count >= MAX_CONSECUTIVE_FAILURES) {
				ctx.ui.notify(
					`Circuit breaker: ${toolName} failed ${count}x in a row. Stopping to prevent infinite loop.`,
					"error"
				);
				aery.sendUserMessage(
					`[circuit-breaker] The tool "${toolName}" has failed ${count} times consecutively. ` +
					`Stop retrying this approach. Report what went wrong and suggest an alternative strategy.`,
					{ deliverAs: "followUp" }
				);
				failures.delete(toolName); // reset after firing
			}
		} else {
			failures.delete(toolName); // reset on success
		}
	});
}
