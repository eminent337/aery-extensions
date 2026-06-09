/**
 * Aery Schedule Tool
 * Allows the agent to schedule one-shot timers or recurring cron jobs.
 */

import type { ExtensionAPI } from "@aryee337/aery";
import { Type } from "typebox";

export default function (aery: ExtensionAPI) {
	const scheduleTool = {
		name: "schedule",
		label: "Schedule",
		description: "Schedule a one-shot timer. Do not wait for it to fire; it runs in the background and will wake you up by sending the prompt as a message.",
		parameters: Type.Object({
			durationSeconds: Type.Number({ description: "The number of seconds to wait before firing the prompt." }),
			prompt: Type.String({ description: "The message to send to yourself when the timer fires." }),
		}),
		async execute(params: any) {
			const ms = params.durationSeconds * 1000;
			setTimeout(() => {
				try {
					aery.sendUserMessage(params.prompt);
				} catch (e) {
					console.error("Failed to execute scheduled prompt:", e);
				}
			}, ms);

			return {
				content: [{ type: "text" as const, text: `Timer scheduled for ${params.durationSeconds} seconds from now.` }],
			};
		},
	};

	aery.registerTool(scheduleTool);
}
