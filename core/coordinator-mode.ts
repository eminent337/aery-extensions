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
import type { ExtensionAPI } from "@eminent337/aery";
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
You are operating in Coordinator Mode. Your role is to:

1. **Research Phase**: Spawn worker agents to investigate different aspects of the problem in parallel
2. **Synthesis Phase**: Collect and analyze worker results from the scratchpad
3. **Implementation Phase**: Spawn workers to implement the solution based on findings
4. **Verification Phase**: Spawn workers to verify the implementation

Guidelines:
- Use the Agent tool to spawn workers with specific, focused tasks
- Use the scratchpad (${SCRATCHPAD_DIR}) to share knowledge between workers
- Each worker should write its findings to the scratchpad with a descriptive key
- Read worker results from the scratchpad before synthesizing
- Keep worker tasks small and focused for better results
- Use TaskCreate to track overall progress
`;

export default function coordinatorMode(pi: ExtensionAPI): void {
	// ─── Spawn Worker Tool ───────────────────────────────────────────────
	pi.registerTool({
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

			pi.sendUserMessage(workerPrompt);

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
	pi.registerTool({
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
	pi.registerTool({
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
	pi.registerTool({
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
	pi.registerTool({
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
	pi.on("session_shutdown", () => {
		workers.clear();
		coordinatorActive = false;
	});
}
