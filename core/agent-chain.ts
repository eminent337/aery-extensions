/**
 * Aery Agent Chain (Phase 3.1)
 * /chain step one | step two | step three
 * Runs sequential prompts, feeding each response into the next.
 * Uses sendUserMessage to chain within the same session (no sub-process needed).
 */

import type { ExtensionAPI } from "@eminent337/aery";

export default function (aery: ExtensionAPI) {
	aery.registerCommand("chain", {
		description: "Run sequential prompts: /chain step one | step two | step three",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify("Usage: /chain step one | step two | step three", "error");
				return;
			}

			const steps = args.split("|").map((s) => s.trim()).filter(Boolean);
			if (steps.length < 2) {
				ctx.ui.notify("Provide at least 2 steps separated by |", "error");
				return;
			}

			ctx.ui.notify(`Starting chain: ${steps.length} steps`, "info");

			// Run first step — subsequent steps are injected as follow-ups
			const chainPrompt = steps.map((step, i) =>
				i === 0
					? step
					: `\n\n---\nStep ${i + 1}/${steps.length}: ${step}\n(Build on your previous response above)`
			).join("");

			aery.sendUserMessage(chainPrompt);
		},
	});
}
