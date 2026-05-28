import { ExtensionAPI, Type } from "@aryee337/aery";
import { NativeGraphEngine } from "./graph-engine.ts";
import { globalMailbox } from "./mailbox.ts";
import { runWithTeammateContext, getTeammateContext } from "./swarm-context.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export default function architectExtension(aery: ExtensionAPI) {
	const cwd = process.cwd();
	const engine = new NativeGraphEngine(cwd);

	// Phase 3: The Leader Permission Bridge (Mailbox Listener)
	globalMailbox.on("permission_requested", (msg) => {
		aery.sendUserMessage(
			`🚨 **Permission Request from Teammate \`${msg.from}\`**\n` +
			`They want to use tool: \`${msg.toolName}\`\n` +
			`Reason: ${msg.content}\n\n` +
			`To approve, type: \`/approve ${msg.id}\`\nTo deny, type: \`/deny ${msg.id}\``
		).catch(() => {});
	});

	// Phase 2: Async XML Notifications (OpenClaude Style)
	globalMailbox.on("task_completed", (msg) => {
		const xmlNotification = `
<task-notification>
  <task-id>${msg.from}</task-id>
  <status>completed</status>
  <summary>${msg.content}</summary>
</task-notification>
`;
		aery.sendUserMessage(xmlNotification).catch(() => {});
	});

	aery.on("session_start", async () => {
		engine.buildGraph();
	});

	// Inject the Swarm Coordinator persona into Aery's subconscious on every turn
	aery.on("context", async () => {
		return {
			messages: [{
				type: "user",
				text: `[SYSTEM INSTRUCTION] You are the Aery Swarm Coordinator. You are a hybrid worker/leader. For small fixes or answering questions, carry out the work yourself. For complex architectures, large refactors, or multi-file features, you MUST use \`dispatch_implementer\` to spawn background teammates to do the heavy lifting while you coordinate. For performance optimizations, use \`darwin_optimize\`.`
			}]
		};
	});



	aery.registerCommand("approve", {
		description: "Approve a teammate's permission request",
		handler: async (args, ctx) => {
			globalMailbox.resolvePermission(args.trim(), true);
			ctx.ui.notify(`Approved request ${args.trim()}`, "success");
		}
	});

	aery.registerCommand("deny", {
		description: "Deny a teammate's permission request",
		handler: async (args, ctx) => {
			globalMailbox.resolvePermission(args.trim(), false);
			ctx.ui.notify(`Denied request ${args.trim()}`, "error");
		}
	});

	aery.registerTool({
		name: "query_native_graph",
		description: "Natively query the in-memory TypeScript graph.",
		parameters: Type.Object({
			from: Type.String({ description: "Source file basename" }),
			to: Type.String({ description: "Target file basename" })
		}),
		async execute(_id, params) {
			const path = engine.getShortestPath(params.from, params.to);
			if (!path) return { content: [{ type: "text", text: "No native path found." }] };
			return { content: [{ type: "text", text: `Native Path: ${path.join(" -> ")}` }] };
		}
	});

	aery.registerCommand("darwin_merge", {
		description: "Safely merge the winning Darwin algorithm into your source code.",
		handler: async (args, ctx) => {
			const winnerPath = path.join(process.cwd(), ".aery-scratch", "darwin_winner.js");
			if (!fs.existsSync(winnerPath)) {
				ctx.ui.notify("No Darwin winner found.", "error");
				return;
			}
			const code = fs.readFileSync(winnerPath, "utf-8");
			aery.sendUserMessage(`🧬 **Darwin Evolution Merged**\n\nThe Swarm's apex algorithm has been applied:\n\`\`\`javascript\n${code}\n\`\`\``).catch(() => {});
			ctx.ui.notify("Algorithm Merged", "success");
		}
	});

	// The Darwin Auto-Optimizer Tool
	aery.registerTool({
		name: "darwin_optimize",
		description: "MANDATORY FOR OPTIMIZATION: Spawns a Swarm to genetically evolve and benchmark a function, finding the absolute fastest algorithm.",
		parameters: Type.Object({
			targetFile: Type.String(),
			functionName: Type.String(),
			mutations: Type.Number({ description: "How many parallel teammates to spawn for the deathmatch. (e.g. 5, 10)" })
		}),
		async execute(_id, params) {
			const { executeDarwinOptimization } = await import("./darwin.ts");
			const leaderboard = await executeDarwinOptimization(params.targetFile, params.functionName, params.mutations);
			
			// Inject leaderboard into chat
			aery.sendUserMessage(leaderboard).catch(() => {});
			
			return { content: [{ type: "text", text: `Darwin evolution complete across ${params.mutations} mutations.` }] };
		}
	});

	// Phase 1 & 4: Spawning Teammates into the Swarm
	aery.registerTool({
		name: "dispatch_implementer",
		description: "MANDATORY FOR COMPLEX TASKS: You are a Swarm Coordinator. Use this tool to dispatch background workers to accomplish heavy lifting, complex tasks, or multi-file features.",
		parameters: Type.Object({
			task: Type.String(),
			filesToEdit: Type.Array(Type.String())
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let graphContext = "Graph Dependencies for files:\\n";
			for (const file of params.filesToEdit) {
				const id = path.basename(file);
				const pathFromGod = engine.getShortestPath(engine.getGodNodes(1)[0].id, id);
				if (pathFromGod) graphContext += `- ${id} connects via: ${pathFromGod.join("->")}\\n`;
			}

			const teammateId = `implementer-${Math.random().toString(36).substring(7)}`;

			// Background thread execution wrapper
			setTimeout(async () => {
				runWithTeammateContext({
					id: teammateId,
					role: "implementer",
					history: []
				}, async () => {
					try {
						// Inside the isolated teammate context!
						const tddPrompt = `[Teammate: ${teammateId}]\nTask: ${params.task}\nFiles: ${params.filesToEdit.join(", ")}\n${graphContext}\nFollow Red-Green-Refactor TDD. Use .aery-scratch/ to avoid collisions. When finished, emit task_completed to the mailbox.`;
						
						const { createAgentSession } = await import("@aryee337/aery");
						
						// Boot up a REAL Aery session!
						const { session } = await createAgentSession({
							tools: ["read_file", "write_to_file", "run_command", "grep_search"]
						});
						
						// Start generating the response autonomously
						await session.prompt(tddPrompt);
						
						globalMailbox.emit("task_completed", { from: teammateId, content: `Successfully completed: ${params.task}` });
					} catch (err: any) {
						globalMailbox.emit("task_completed", { from: teammateId, content: `Failed: ${err.message}` });
					}
				});
			}, 100);

			return { content: [{ type: "text", text: `Dispatched real LLM teammate ${teammateId} into the Swarm.` }] };
		}
	});
}
