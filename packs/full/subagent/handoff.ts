import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";
import type { AgentToolResult } from "@aryee337/aery-core";

const HandoffParams = Type.Object({
	target_agent: Type.String({
		description: "The name of the agent to hand off to (e.g., 'worker', 'explore', 'reviewer', etc.)"
	}),
	objective: Type.String({
		description: "The specific objective or task description for the target agent."
	})
});

export function registerHandoffTool(aery: ExtensionAPI) {
	const handoffTool: ToolDefinition<typeof HandoffParams, { target_agent: string; objective: string }> = {
		name: "transfer_to_agent",
		label: "Handoff to Agent",
		description: [
			"Yield your execution and permanently transfer control to another specialized agent.",
			"Use this when you have completed your part of a multi-step workflow and need a different agent (like a worker or reviewer) to continue.",
			"The target agent will receive your full conversation history."
		].join(" "),
		parameters: HandoffParams,

		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text", text: `Initiating seamless handoff to agent: ${params.target_agent}...` }],
				details: {
					target_agent: params.target_agent,
					objective: params.objective
				},
				// This tells the current Aery loop to stop executing immediately
				terminate: true
			};
		}
	};

	aery.registerTool(handoffTool);
}
