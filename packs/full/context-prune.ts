import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";

// Context Pruning Tool - summarizes conversation history to save tokens
const ContextPruneParams = Type.Object({
	summary: Type.String({
		description: "A concise summary of what has been accomplished so far in this conversation/session."
	}),
	retainedContext: Type.Optional(Type.String({
		description: "Key details, decisions, or code context that MUST be preserved for future turns."
	})),
	remainingTasks: Type.Optional(Type.Array(Type.String(), {
		description: "List of remaining tasks or next steps still to be completed."
	}))
});

const ContextStatusParams = Type.Object({});

export function registerContextPruneTool(aery: ExtensionAPI) {
	// Track session context state
	let sessionSummary = "";
	let retainedDetails = "";
	let pendingTasks: string[] = [];
	let pruneCount = 0;

	const pruneTool: ToolDefinition<typeof ContextPruneParams, {
		summary: string;
		retainedContext?: string;
		remainingTasks?: string[];
	}> = {
		name: "ContextPruneTool",
		label: "Context Prune",
		description: "Summarize the current session context to manage token usage. Call this when the conversation is getting long to create a checkpoint of what's been done and what remains. The summary is stored and can be retrieved with ContextStatusTool.",
		parameters: ContextPruneParams,
		async execute(_id, params) {
			pruneCount++;
			sessionSummary = params.summary;
			if (params.retainedContext) {
				retainedDetails = params.retainedContext;
			}
			if (params.remainingTasks) {
				pendingTasks = params.remainingTasks;
			}

			let response = `✅ Context pruned (checkpoint #${pruneCount})\n\n`;
			response += `**Summary:** ${sessionSummary}\n`;
			if (retainedDetails) {
				response += `\n**Retained:** ${retainedDetails}\n`;
			}
			if (pendingTasks.length > 0) {
				response += `\n**Remaining (${pendingTasks.length}):**\n`;
				for (const t of pendingTasks) {
					response += `- ${t}\n`;
				}
			}

			return {
				content: [{ type: "text", text: response }],
			};
		}
	};

	const statusTool: ToolDefinition<typeof ContextStatusParams, {}> = {
		name: "ContextStatusTool",
		label: "Context Status",
		description: "Retrieve the current context pruning summary to remind the agent of what has been accomplished and what remains.",
		parameters: ContextStatusParams,
		async execute() {
			if (!sessionSummary) {
				return {
					content: [{ type: "text", text: "No context has been pruned yet. Use ContextPruneTool to create a checkpoint." }],
				};
			}

			let response = `📋 Session Context (checkpoint #${pruneCount})\n\n`;
			response += `**Summary:** ${sessionSummary}\n`;
			if (retainedDetails) {
				response += `\n**Retained Context:** ${retainedDetails}\n`;
			}
			if (pendingTasks.length > 0) {
				response += `\n**Pending Tasks:**\n`;
				for (const t of pendingTasks) {
					response += `- ${t}\n`;
				}
			}

			return {
				content: [{ type: "text", text: response }],
			};
		}
	};

	aery.registerTool(pruneTool);
	aery.registerTool(statusTool);
}
