/**
 * Coordinator Mode Extension
 *
 * Multi-agent orchestration: coordinator dispatches work to worker agents,
 * coordinates via tasks and messages, synthesizes results.
 *
 * Workflow: Research (parallel) → Synthesis → Implementation → Verification
 *
 * Commands:
 *   /coordinator — enter coordinator mode
 *   /workers — list active workers
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@aryee337/aery";
import { Type } from "typebox";

const SCRATCHPAD_DIR = join(homedir(), ".aery", "scratchpad");

interface Worker {
	name: string;
	task: string;
	status: "idle" | "working" | "done" | "error";
	startedAt?: string;
}

// In-memory state
const workers = new Map<string, Worker>();
let coordinatorActive = false;

function ensureScratchpad(): void {
	if (!existsSync(SCRATCHPAD_DIR)) {
		mkdirSync(SCRATCHPAD_DIR, { recursive: true });
	}
}

function writeScratchpad(key: string, content: string): void {
	ensureScratchpad();
	writeFileSync(join(SCRATCHPAD_DIR, `${key}.md`), content);
}

function readScratchpad(key: string): string | null {
	const path = join(SCRATCHPAD_DIR, `${key}.md`);
	if (!existsSync(path)) return null;
	return readFileSync(path, "utf-8");
}

const COORDINATOR_SYSTEM_PROMPT = `

## Coordinator Mode — Graph-Native Aery Orchestration

You are operating as a **Graph-Native Coordinator**. Your job is to direct workers to research, implement, and verify code changes by leveraging the codebase knowledge graph, keeping your own context clean.

### Core Workflow

1. **Graph Exploration** — Before launching workers, use \`query_graph\`, \`god_nodes\`, and \`graph_path\` (if available) to map out dependencies.
   - Identify if the requested feature spans multiple disconnected subgraphs.
   - Find the "God Nodes" (highly connected files) that might be affected.

2. **Graph Insights Scratchpad** — After exploring the graph, write your architectural map and shortest paths to the scratchpad.
   - Scratchpad location: ${SCRATCHPAD_DIR}
   - Example key: \`.superpowers/graph_insights/auth_to_db\`
   - Workers DO NOT have graph tools. You must provide them with the graph insights they need via the scratchpad.

3. **Graph-Driven Task Routing (Parallel Research & Implementation)** — Spawn parallel workers based on your graph insights.
   - If \`Component A\` and \`Component B\` are disconnected in the graph, spawn two parallel workers to handle them simultaneously.
   - Use the \`spawn_worker\` tool for open-ended research or implementation.
   - Give every worker a short \`name\` and point them to their specific scratchpad key.

4. **Synthesis & Verification** — Combine findings and verify changes.
   - When workers complete, review their scratchpad outputs.
   - If a God Node was touched, you MUST spawn an adversarial verification agent to ensure no downstream dependencies were broken.

### Concurrency rules
- Read-only research can run in parallel freely.
- Implementations on completely disconnected subgraphs can run in parallel.
- Edits to the same or highly connected files must be serialized.
`;


export default function coordinatorMode(aery: ExtensionAPI): void {
	// ─── Coordinator Mode Command ────────────────────────────────────────
	aery.registerCommand("coordinator", {
		description: "Enter Aery coordinator mode for multi-agent workflows",
		handler: async (args, ctx) => {
			coordinatorActive = true;
			const extra = args ? `\n\nUser goal/context: ${args}` : "";
			aery.sendUserMessage(
				`Coordinator mode is now active. Use Aery multi-agent orchestration: research with background agents, synthesize notifications, dispatch implementation workers, verify adversarially, then conclude.${extra}`,
			).catch(() => {});
			ctx.ui.notify("Coordinator mode enabled", "info");
		},
	});

	aery.registerCommand("coordinator-off", {
		description: "Exit coordinator mode",
		handler: async (_args, ctx) => {
			coordinatorActive = false;
			ctx.ui.notify("Coordinator mode disabled", "info");
		},
	});

	aery.on("before_agent_start", (event) => {
		if (!coordinatorActive) return {};
		const existingPrompt = event.systemPrompt ?? "";
		if (existingPrompt.includes("## Coordinator Mode — Aery agent orchestration")) {
			return {};
		}
		return { systemPrompt: existingPrompt + COORDINATOR_SYSTEM_PROMPT };
	});

	// ─── Spawn Worker Tool ───────────────────────────────────────────────
	aery.registerTool({
		name: "spawn_worker",
		description:
			"Spawn a worker agent for a specific task. Workers run autonomously and write results to the scratchpad.",
		promptSnippet: "spawn a worker agent for parallel work",
		promptGuidelines: [
			"Use spawn_worker to delegate work to autonomous agents",
			"Workers write results to the scratchpad for you to read",
			"Give workers focused, specific tasks for best results",
			"Multiple workers can run in parallel",
		],
		parameters: Type.Object({
			name: Type.String({
				description: "A short name for the worker (e.g., 'researcher', 'tester')",
			}),
			task: Type.String({
				description: "The specific task for the worker to accomplish",
			}),
			scratchpad_key: Type.String({
				description: "Key for the worker to write results to in the scratchpad",
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const workerName = params.name;

			workers.set(workerName, {
				name: workerName,
				task: params.task,
				status: "working",
				startedAt: new Date().toISOString(),
			});

			// Send the task as a user message with worker context
			const workerPrompt = `[Worker: ${workerName}]
Task: ${params.task}

Write your findings to the scratchpad at: ${SCRATCHPAD_DIR}/${params.scratchpad_key}.md

After completing your task, report what you found.`;

			aery.sendUserMessage(workerPrompt).catch(() => {});

			return {
				content: [
					{
						type: "text" as const,
						text: `Spawned worker "${workerName}" for task: ${params.task}\nResults will be written to scratchpad key: ${params.scratchpad_key}`,
					},
				],
			};
		},
	});

	// ─── Read Scratchpad Tool ────────────────────────────────────────────
	aery.registerTool({
		name: "read_scratchpad",
		description: "Read a worker's results from the scratchpad.",
		parameters: Type.Object({
			key: Type.String({
				description: "The scratchpad key to read",
			}),
		}),
		async execute(_id, params) {
			const content = readScratchpad(params.key);

			if (!content) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No scratchpad entry found for key: ${params.key}`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `Scratchpad[${params.key}]:\n\n${content}`,
					},
				],
			};
		},
	});

	// ─── Write Scratchpad Tool ───────────────────────────────────────────
	aery.registerTool({
		name: "write_scratchpad",
		description: "Write content to the scratchpad for cross-worker knowledge sharing.",
		parameters: Type.Object({
			key: Type.String({
				description: "The scratchpad key to write to",
			}),
			content: Type.String({
				description: "The content to write",
			}),
		}),
		async execute(_id, params) {
			writeScratchpad(params.key, params.content);

			return {
				content: [
					{
						type: "text" as const,
						text: `Wrote to scratchpad[${params.key}]`,
					},
				],
			};
		},
	});

	// ─── List Workers Tool ───────────────────────────────────────────────
	aery.registerTool({
		name: "list_workers",
		description: "List all active workers and their status.",
		parameters: Type.Object({}),
		async execute() {
			if (workers.size === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No active workers.",
						},
					],
				};
			}

			const lines = [...workers.values()].map(
				(w) =>
					`- ${w.name} [${w.status}]: ${w.task.slice(0, 80)}`,
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `Workers (${workers.size}):\n${lines.join("\n")}`,
					},
				],
			};
		},
	});

	// ─── Mark Worker Done ────────────────────────────────────────────────
	aery.registerTool({
		name: "complete_worker",
		description: "Mark a worker as completed.",
		parameters: Type.Object({
			name: Type.String({
				description: "The worker name to mark as done",
			}),
			status: Type.Optional(
				Type.Union(
					[Type.Literal("done"), Type.Literal("error")],
					{
						description: "Final status (default: done)",
					},
				),
			),
		}),
		async execute(_id, params) {
			const worker = workers.get(params.name);
			if (!worker) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Worker not found: ${params.name}`,
						},
					],
					isError: true,
				};
			}

			worker.status = params.status ?? "done";

			return {
				content: [
					{
						type: "text" as const,
						text: `Worker "${params.name}" marked as ${worker.status}`,
					},
				],
			};
		},
	});

	// ─── Cleanup on shutdown ─────────────────────────────────────────────
	aery.on("session_shutdown", () => {
		workers.clear();
		coordinatorActive = false;
	});
}
