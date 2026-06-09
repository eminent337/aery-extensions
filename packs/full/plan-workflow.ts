import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";

const EnterPlanModeParams = Type.Object({});
const ExitPlanModeParams = Type.Object({
	planSummary: Type.String({
		description: "A summary of the plan you have designed, including critical files to modify.",
	}),
});

export function registerEnterPlanModeTool(aery: ExtensionAPI) {
	const enterPlanModeTool: ToolDefinition<typeof EnterPlanModeParams, {}> = {
		name: "EnterPlanMode",
		label: "Enter Plan Mode",
		description: "Enter Plan Mode. Use this BEFORE starting massive refactors or complex implementations. It pauses normal execution and shifts your focus entirely to architectural exploration and planning.",
		parameters: EnterPlanModeParams,
		async execute() {
			return {
				content: [{ 
					type: "text", 
					text: "Entered Plan Mode. You are now restricted to exploration tools. Gather context, identify critical files, and draft your plan. When ready, call ExitPlanMode to request user approval." 
				}],
			};
		}
	};

	aery.registerTool(enterPlanModeTool);
}

export function registerExitPlanModeTool(aery: ExtensionAPI) {
	const exitPlanModeTool: ToolDefinition<typeof ExitPlanModeParams, { planSummary: string }> = {
		name: "ExitPlanMode",
		label: "Exit Plan Mode",
		description: "Exit Plan Mode. Call this when you have completed your implementation plan. It will present the plan to the user for approval. If approved, you may proceed with the implementation.",
		parameters: ExitPlanModeParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Proceeding with plan (no UI available for approval)." }],
				};
			}

			const approved = await ctx.ui.confirm(
				"AI wants to exit Plan Mode and execute the following plan:",
				params.planSummary
			);

			if (approved) {
				return {
					content: [{ type: "text", text: "Plan approved by user. You may now proceed with the execution phase using edit tools." }],
				};
			} else {
				// We can ask for feedback, but for simplicity we just return rejected.
				return {
					content: [{ type: "text", text: "Plan REJECTED by user. Please ask the user for feedback and revise the plan." }],
					isError: true
				};
			}
		}
	};

	aery.registerTool(exitPlanModeTool);
}

export default function planWorkflow(aery: ExtensionAPI) {
	registerEnterPlanModeTool(aery);
	registerExitPlanModeTool(aery);
}
