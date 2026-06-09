import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@aryee337/aery";
import { Type } from "typebox";

const PLAN_DIR = ".aery/plans";
const PLAN_FILE = "current-plan.md";

let planModeActive = false;
let pendingApproval = false;

function planPath(cwd: string): string {
	return join(cwd, PLAN_DIR, PLAN_FILE);
}

function ensurePlanDir(cwd: string): void {
	const dir = join(cwd, PLAN_DIR);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const PLAN_MODE_PROMPT = `

## Plan Mode

You are in plan mode. Do not edit files or run destructive commands. Explore the codebase, understand the implementation options, and write a clear implementation plan to .aery/plans/current-plan.md.

Use ExitPlanMode when the plan is ready for user approval. Do not ask "is this plan okay" with AskUserQuestion; ExitPlanMode handles approval.
`;

export default function planModeTools(aery: ExtensionAPI): void {
	aery.registerTool({
		name: "EnterPlanMode",
		description: "Enter plan mode before non-trivial implementation. Creates .aery/plans/current-plan.md and injects planning guidance.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			planModeActive = true;
			pendingApproval = false;
			ensurePlanDir(ctx.cwd);
			const file = planPath(ctx.cwd);
			if (!existsSync(file)) {
				writeFileSync(file, "# Implementation Plan\n\n", "utf-8");
			}
			return {
				content: [{ type: "text" as const, text: `Entered plan mode. Write the plan to ${file}, then call ExitPlanMode for approval.` }],
				details: { file },
			};
		},
	});

	aery.registerTool({
		name: "ExitPlanMode",
		description: "Request user approval for the plan in .aery/plans/current-plan.md. Does not implement; waits for user approval.",
		parameters: Type.Object({
			allowedPrompts: Type.Optional(Type.Array(Type.Object({
				tool: Type.String({ description: "Tool this permission applies to" }),
				prompt: Type.String({ description: "Semantic permission description" }),
			}), { description: "Prompt-based permissions needed to implement the plan" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const file = planPath(ctx.cwd);
			if (!existsSync(file)) {
				return {
					content: [{ type: "text" as const, text: `No plan file found at ${file}. Write the plan before calling ExitPlanMode.` }],
					isError: true,
				};
			}
			const plan = readFileSync(file, "utf-8").trim();
			if (!plan || plan === "# Implementation Plan") {
				return {
					content: [{ type: "text" as const, text: `Plan file is empty: ${file}. Write a complete plan before calling ExitPlanMode.` }],
					isError: true,
				};
			}

			pendingApproval = true;
			const permissions = params.allowedPrompts?.length
				? `\n\nRequested implementation permissions:\n${params.allowedPrompts.map((p: any) => `- ${p.tool}: ${p.prompt}`).join("\n")}`
				: "";
			aery.sendUserMessage(`Plan ready for approval. Reply with approval or requested changes.\n\n${plan}${permissions}`).catch(() => {});
			return {
				content: [{ type: "text" as const, text: "Plan approval requested. Wait for the user's response before implementing." }],
				details: { file, pendingApproval: true },
			};
		},
	});

	aery.registerCommand("approve-plan", {
		description: "Approve the current plan and exit plan mode",
		handler: async (_args, ctx) => {
			planModeActive = false;
			pendingApproval = false;
			ctx.ui.notify("Plan approved", "success");
		},
	});

	aery.registerCommand("reject-plan", {
		description: "Reject the current plan and stay in plan mode",
		handler: async (_args, ctx) => {
			pendingApproval = false;
			planModeActive = true;
			ctx.ui.notify("Plan rejected; staying in plan mode", "warning");
		},
	});

	aery.on("before_agent_start", (event) => {
		if (!planModeActive) return {};
		const existing = event.systemPrompt ?? "";
		if (existing.includes("## Plan Mode")) return {};
		const approvalNote = pendingApproval ? "\n\nA plan is pending approval. Do not implement until the user approves it." : "";
		return { systemPrompt: existing + PLAN_MODE_PROMPT + approvalNote };
	});
}
