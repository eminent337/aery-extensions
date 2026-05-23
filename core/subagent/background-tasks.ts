/**
 * Background Task Manager
 *
 * Tracks running background agents, provides list/kill/status operations,
 * stores completed results for SendMessage follow-ups.
 */

import type { ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@eminent337/aery";

export interface BackgroundTask {
	id: string;
	agentName: string;
	task: string;
	status: "running" | "completed" | "failed" | "killed";
	startedAt: number;
	completedAt?: number;
	proc?: ChildProcess;
	outputFile: string;
	result?: {
		output: string;
		exitCode: number;
		usage: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			cost: number;
			turns: number;
		};
		model?: string;
	};
}

// In-memory task registry
const tasks = new Map<string, BackgroundTask>();

export function registerBackgroundTask(
	id: string,
	agentName: string,
	task: string,
	proc: ChildProcess | undefined,
	outputFile: string,
): void {
	const existing = tasks.get(id);
	if (existing) {
		existing.agentName = agentName;
		existing.task = task;
		existing.proc = proc ?? existing.proc;
		existing.outputFile = outputFile;
		return;
	}

	tasks.set(id, {
		id,
		agentName,
		task,
		status: "running",
		startedAt: Date.now(),
		proc,
		outputFile,
	});
}

export function completeBackgroundTask(
	id: string,
	result: BackgroundTask["result"],
): void {
	const task = tasks.get(id);
	if (!task) return;
	task.status = result && result.exitCode === 0 ? "completed" : "failed";
	task.completedAt = Date.now();
	task.result = result;
	task.proc = undefined; // Release process reference
}

export function killBackgroundTask(id: string): boolean {
	const task = tasks.get(id);
	if (!task || task.status !== "running" || !task.proc) return false;
	task.proc.kill("SIGTERM");
	setTimeout(() => {
		if (task.proc && !task.proc.killed) task.proc.kill("SIGKILL");
	}, 5000);
	task.status = "killed";
	task.completedAt = Date.now();
	task.proc = undefined;
	return true;
}

export function getBackgroundTask(id: string): BackgroundTask | undefined {
	return tasks.get(id);
}

export function findTaskByNameOrId(nameOrId: string): BackgroundTask | undefined {
	// Try direct ID lookup first
	if (tasks.has(nameOrId)) return tasks.get(nameOrId);
	// Search by agent name (most recent first)
	const entries = [...tasks.values()].reverse();
	return entries.find((t) => t.agentName === nameOrId);
}

export function listBackgroundTasks(): BackgroundTask[] {
	return [...tasks.values()];
}

export function getRunningTasks(): BackgroundTask[] {
	return [...tasks.values()].filter((t) => t.status === "running");
}

export function getCompletedTasks(): BackgroundTask[] {
	return [...tasks.values()].filter((t) => t.status === "completed" || t.status === "failed");
}

export function formatTaskList(): string {
	const all = listBackgroundTasks();
	if (all.length === 0) return "No background tasks.";

	const lines = all.map((t) => {
		const icon = t.status === "running" ? "→" : t.status === "completed" ? "✓" : t.status === "killed" ? "✗" : "✗";
		const duration = t.completedAt
			? `${((t.completedAt - t.startedAt) / 1000).toFixed(1)}s`
			: `${((Date.now() - t.startedAt) / 1000).toFixed(1)}s (running)`;
		const agent = t.agentName;
		const preview = t.task.length > 60 ? `${t.task.slice(0, 60)}...` : t.task;
		return `${icon} ${t.id} [${agent}] ${t.status} (${duration})\n  ${preview}`;
	});

	return `Background Tasks (${all.length}):\n${lines.join("\n")}`;
}

/**
 * Register background task management tools with the extension API.
 */
export function registerBackgroundTaskTools(aery: ExtensionAPI): void {
	// ─── List Background Tasks ─────────────────────────────────────────
	aery.registerTool({
		name: "background_tasks",
		description: "List all background agents — running, completed, and failed. Shows agent name, task, status, and duration.",
		parameters: {
			type: "object",
			properties: {
				filter: {
					type: "string",
					enum: ["all", "running", "completed"],
					description: "Filter by status. Default: all",
				},
			},
		},
		async execute(_id, params) {
			const filter = (params as { filter?: string }).filter || "all";
			let filtered = listBackgroundTasks();
			if (filter === "running") filtered = filtered.filter((t) => t.status === "running");
			if (filter === "completed") filtered = filtered.filter((t) => t.status !== "running");

			if (filtered.length === 0) {
				return { content: [{ type: "text", text: `No ${filter} background tasks.` }] };
			}

			const lines = filtered.map((t) => {
				const icon = t.status === "running" ? "→" : t.status === "completed" ? "✓" : "✗";
				const duration = t.completedAt
					? `${((t.completedAt - t.startedAt) / 1000).toFixed(1)}s`
					: `${((Date.now() - t.startedAt) / 1000).toFixed(1)}s (running)`;
				return `${icon} ${t.id} [${t.agentName}] ${t.status} (${duration}) — ${t.task.slice(0, 80)}`;
			});

			return { content: [{ type: "text", text: lines.join("\n") }] };
		},
	});

	// ─── Kill Background Task ──────────────────────────────────────────
	aery.registerTool({
		name: "kill_background_task",
		description: "Kill a running background agent by ID or agent name.",
		parameters: {
			type: "object",
			properties: {
				taskId: {
					type: "string",
					description: "Task ID or agent name to kill",
				},
			},
			required: ["taskId"],
		},
		async execute(_id, params) {
			const { taskId } = params as { taskId: string };
			const task = findTaskByNameOrId(taskId);
			if (!task) {
				return { content: [{ type: "text", text: `No task found: ${taskId}` }], isError: true };
			}
			if (task.status !== "running") {
				return { content: [{ type: "text", text: `Task ${task.id} is already ${task.status}.` }] };
			}
			const killed = killBackgroundTask(task.id);
			return {
				content: [{ type: "text", text: killed ? `Killed background task ${task.id} (${task.agentName}).` : "Failed to kill task." }],
			};
		},
	});

	// ─── Aery Agent-compatible TaskStop ─────────────────────────────────
	aery.registerTool({
		name: "TaskStop",
		description: "Stop a running background agent by task ID or agent name.",
		parameters: {
			type: "object",
			properties: {
				task_id: { type: "string", description: "Task ID or agent name to stop" },
				shell_id: { type: "string", description: "Deprecated alias for task_id" },
			},
		},
		async execute(_id, params) {
			const { task_id, shell_id } = params as { task_id?: string; shell_id?: string };
			const target = task_id ?? shell_id;
			if (!target) {
				return { content: [{ type: "text", text: "task_id is required" }], isError: true };
			}
			const task = findTaskByNameOrId(target);
			if (!task) {
				return { content: [{ type: "text", text: `No task found: ${target}` }], isError: true };
			}
			if (task.status !== "running") {
				return { content: [{ type: "text", text: `Task ${task.id} is already ${task.status}.` }] };
			}
			const killed = killBackgroundTask(task.id);
			return { content: [{ type: "text", text: killed ? `Stopped background task ${task.id} (${task.agentName}).` : "Failed to stop task." }] };
		},
	});

	// ─── Aery Agent-compatible TaskOutput ────────────────────────────────
	aery.registerTool({
		name: "TaskOutput",
		description: "Read output from a background agent by task ID or agent name.",
		parameters: {
			type: "object",
			properties: {
				task_id: { type: "string", description: "Task ID or agent name" },
				block: { type: "boolean", description: "Accepted for compatibility; output is returned if available" },
				timeout: { type: "number", description: "Accepted for compatibility" },
			},
			required: ["task_id"],
		},
		async execute(_id, params) {
			const { task_id } = params as { task_id: string };
			const task = findTaskByNameOrId(task_id);
			if (!task) {
				return { content: [{ type: "text", text: `No task found: ${task_id}` }], isError: true };
			}
			if (task.status === "running") {
				return { content: [{ type: "text", text: `Task ${task.id} is still running. Output file: ${task.outputFile}` }] };
			}
			const output = task.result?.output ?? "(no output)";
			return { content: [{ type: "text", text: output }] };
		},
	});
}
