/**
 * Task System v2 — Create, manage, and track tasks with dependencies.
 * Supports blocking/blockedBy, metadata, status transitions.
 */

import type { ExtensionAPI } from "@aryee337/aery";
import { registerToolAliases } from "./tool-aliases.js";
import { Type } from "typebox";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TASKS_DIR = join(homedir(), ".aery", "tasks");

interface Task {
	id: string;
	subject: string;
	description: string;
	activeForm?: string;
	status: "pending" | "in_progress" | "completed" | "deleted";
	owner?: string;
	blocks: string[];
	blockedBy: string[];
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

function ensureTasksDir(): void {
	if (!existsSync(TASKS_DIR)) {
		mkdirSync(TASKS_DIR, { recursive: true });
	}
}

function loadTasks(): Task[] {
	ensureTasksDir();
	const file = join(TASKS_DIR, "tasks.json");
	if (!existsSync(file)) return [];
	try {
		return JSON.parse(readFileSync(file, "utf-8"));
	} catch {
		return [];
	}
}

function saveTasks(tasks: Task[]): void {
	ensureTasksDir();
	const file = join(TASKS_DIR, "tasks.json");
	writeFileSync(file, JSON.stringify(tasks, null, 2));
}

function findTask(tasks: Task[], id: string): Task | undefined {
	return tasks.find((t) => t.id === id && t.status !== "deleted");
}

export function registerTaskTools(aery: ExtensionAPI): void {
	// ─── TaskCreate ──────────────────────────────────────────────────────
	aery.registerTool({
		name: "task_create",
		description: "Create a new task with subject, description, and optional dependencies.",
		promptSnippet: "create a task in the task list",
		promptGuidelines: [
			"Use task_create to add tasks to the task list",
			"Use addBlockedBy to specify task dependencies",
			"Use addBlocks to specify what this task blocks",
		],
		parameters: Type.Object({
			subject: Type.String({
				description: "A brief, actionable title in imperative form",
			}),
			description: Type.String({
				description: "What needs to be done",
			}),
			activeForm: Type.Optional(
				Type.String({
					description:
						'Present continuous form shown when in_progress (e.g., "Running tests")',
				}),
			),
			metadata: Type.Optional(
				Type.Record(Type.String(), Type.Unknown(), {
					description: "Arbitrary metadata to attach to the task",
				}),
			),
			addBlockedBy: Type.Optional(
				Type.Array(Type.String(), {
					description: "Task IDs that must complete before this one",
				}),
			),
			addBlocks: Type.Optional(
				Type.Array(Type.String(), {
					description: "Task IDs that this task blocks",
				}),
			),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
			const now = new Date().toISOString();

			const task: Task = {
				id,
				subject: params.subject,
				description: params.description,
				activeForm: params.activeForm,
				status: "pending",
				blocks: params.addBlocks ?? [],
				blockedBy: params.addBlockedBy ?? [],
				metadata: params.metadata,
				createdAt: now,
				updatedAt: now,
			};

			// Update blocking references on other tasks
			if (params.addBlockedBy) {
				for (const blockerId of params.addBlockedBy) {
					const blocker = findTask(tasks, blockerId);
					if (blocker && !blocker.blocks.includes(id)) {
						blocker.blocks.push(id);
					}
				}
			}
			if (params.addBlocks) {
				for (const blockedId of params.addBlocks) {
					const blocked = findTask(tasks, blockedId);
					if (blocked && !blocked.blockedBy.includes(id)) {
						blocked.blockedBy.push(id);
					}
				}
			}

			tasks.push(task);
			saveTasks(tasks);

			return {
				content: [
					{
						type: "text" as const,
						text: `Created task ${id}: ${params.subject}`,
					},
				],
				details: { id, subject: params.subject },
			};
		},
	});

	// ─── TaskGet ─────────────────────────────────────────────────────────
	aery.registerTool({
		name: "task_get",
		description: "Retrieve a task by its ID.",
		parameters: Type.Object({
			taskId: Type.String({
				description: "The task ID to retrieve",
			}),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const task = findTask(tasks, params.taskId);

			if (!task) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Task not found: ${params.taskId}`,
						},
					],
					isError: true,
				};
			}

			const lines = [
				`**${task.subject}** (${task.status})`,
				`ID: ${task.id}`,
				task.description,
				`Created: ${task.createdAt}`,
				`Updated: ${task.updatedAt}`,
			];

			if (task.owner) lines.push(`Owner: ${task.owner}`);
			if (task.activeForm) lines.push(`Active form: ${task.activeForm}`);
			if (task.blocks.length > 0)
				lines.push(`Blocks: ${task.blocks.join(", ")}`);
			if (task.blockedBy.length > 0)
				lines.push(`Blocked by: ${task.blockedBy.join(", ")}`);
			if (task.metadata)
				lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);

			return {
				content: [
					{ type: "text" as const, text: lines.join("\n") },
				],
			};
		},
	});

	// ─── TaskList ────────────────────────────────────────────────────────
	aery.registerTool({
		name: "task_list",
		description:
			"List all tasks. Filter by status, owner, or blocking info.",
		parameters: Type.Object({
			status: Type.Optional(
				Type.Union(
					[
						Type.Literal("pending"),
						Type.Literal("in_progress"),
						Type.Literal("completed"),
						Type.Literal("all"),
					],
					{
						description: "Filter by status (default: all non-deleted)",
					},
				),
			),
			owner: Type.Optional(
				Type.String({
					description: "Filter by owner name",
				}),
			),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const status = params.status ?? "all";

			let filtered = tasks.filter((t) => t.status !== "deleted");

			if (status !== "all") {
				filtered = filtered.filter((t) => t.status === status);
			}

			if (params.owner) {
				filtered = filtered.filter((t) => t.owner === params.owner);
			}

			if (filtered.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No tasks found.",
						},
					],
				};
			}

			const lines = filtered.map((t) => {
				const statusIcon =
					t.status === "completed"
						? "[x]"
						: t.status === "in_progress"
							? "[>]"
							: "[ ]";
				const blocked = t.blockedBy.length > 0
					? ` (blocked by: ${t.blockedBy.join(", ")})`
					: "";
				return `${statusIcon} ${t.id}: ${t.subject}${blocked}`;
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Tasks (${filtered.length}):\n${lines.join("\n")}`,
					},
				],
				details: { count: filtered.length },
			};
		},
	});

	// ─── TaskUpdate ──────────────────────────────────────────────────────
	aery.registerTool({
		name: "task_update",
		description:
			"Update a task's status, owner, subject, description, or dependencies.",
		parameters: Type.Object({
			taskId: Type.String({ description: "The task ID to update" }),
			status: Type.Optional(
				Type.Union(
					[
						Type.Literal("pending"),
						Type.Literal("in_progress"),
						Type.Literal("completed"),
						Type.Literal("deleted"),
					],
					{ description: "New status" },
				),
			),
			subject: Type.Optional(
				Type.String({ description: "New subject" }),
			),
			description: Type.Optional(
				Type.String({ description: "New description" }),
			),
			activeForm: Type.Optional(
				Type.String({ description: "New active form" }),
			),
			owner: Type.Optional(
				Type.String({ description: "New owner" }),
			),
			metadata: Type.Optional(
				Type.Record(Type.String(), Type.Unknown(), {
					description: "Metadata to merge into task",
				}),
			),
			addBlocks: Type.Optional(
				Type.Array(Type.String(), {
					description: "Task IDs to add to blocks",
				}),
			),
			addBlockedBy: Type.Optional(
				Type.Array(Type.String(), {
					description: "Task IDs to add to blockedBy",
				}),
			),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const task = findTask(tasks, params.taskId);

			if (!task) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Task not found: ${params.taskId}`,
						},
					],
					isError: true,
				};
			}

			// Apply updates
			if (params.status) task.status = params.status;
			if (params.subject) task.subject = params.subject;
			if (params.description) task.description = params.description;
			if (params.activeForm) task.activeForm = params.activeForm;
			if (params.owner) task.owner = params.owner;
			if (params.metadata) {
				task.metadata = { ...task.metadata, ...params.metadata };
			}
			if (params.addBlocks) {
				for (const id of params.addBlocks) {
					if (!task.blocks.includes(id)) task.blocks.push(id);
				}
			}
			if (params.addBlockedBy) {
				for (const id of params.addBlockedBy) {
					if (!task.blockedBy.includes(id))
						task.blockedBy.push(id);
				}
			}
			task.updatedAt = new Date().toISOString();

			saveTasks(tasks);

			return {
				content: [
					{
						type: "text" as const,
						text: `Updated task ${task.id}: ${task.subject} (${task.status})`,
					},
				],
			};
		},
	});

	// ─── TaskStop ────────────────────────────────────────────────────────
	aery.registerTool({
		name: "task_stop",
		description: "Stop a running background task.",
		parameters: Type.Object({
			taskId: Type.String({
				description: "The task ID to stop",
			}),
		}),
		async execute(_id, params) {
			const tasks = loadTasks();
			const task = findTask(tasks, params.taskId);

			if (!task) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Task not found: ${params.taskId}`,
						},
					],
					isError: true,
				};
			}

			if (task.status !== "in_progress") {
				return {
					content: [
						{
							type: "text" as const,
							text: `Task ${task.id} is not in_progress (status: ${task.status})`,
						},
					],
				};
			}

			task.status = "pending";
			task.updatedAt = new Date().toISOString();
			saveTasks(tasks);

			return {
				content: [
					{
						type: "text" as const,
						text: `Stopped task ${task.id}: ${task.subject}`,
					},
				],
			};
		},
	});

	// ─── Aery Agent-compatible aliases ───────────────────────────────────
	registerToolAliases(aery, {
		task_create: "TaskCreate",
		task_get: "TaskGet",
		task_list: "TaskList",
		task_update: "TaskUpdate",
	});
}
