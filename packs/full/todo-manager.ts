/**
 * Aery Todo Manager
 * TodoWrite/TodoRead tools for the LLM to manage its own task list during complex work.
 * Mirrors Claude Code's TodoWrite/TodoRead behavior.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

const TODO_DIR = join(homedir(), ".aery", "agent", "todos");

interface TodoItem {
	id: string;
	content: string;
	status: "pending" | "in_progress" | "completed";
	priority: "high" | "medium" | "low";
}

function getTodoPath(sessionId: string): string {
	if (!existsSync(TODO_DIR)) mkdirSync(TODO_DIR, { recursive: true });
	return join(TODO_DIR, `${sessionId}.json`);
}

function readTodos(sessionId: string): TodoItem[] {
	const path = getTodoPath(sessionId);
	if (!existsSync(path)) return [];
	try { return JSON.parse(readFileSync(path, "utf-8")); }
	catch { return []; }
}

function writeTodos(sessionId: string, todos: TodoItem[]): void {
	writeFileSync(getTodoPath(sessionId), JSON.stringify(todos, null, 2));
}

export default function (aery: ExtensionAPI) {
	let sessionId = `session-${Date.now()}`;

	aery.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager?.getSessionId?.() || `session-${Date.now()}`;
	});

	aery.registerTool({
		name: "TodoWrite",
		description: "Create or update your task list. Use this to track multi-step work. Call at start of complex tasks and update as you complete steps.",
		parameters: Type.Object({
			todos: Type.Array(Type.Object({
				id: Type.String({ description: "Unique ID like 'task-1'" }),
				content: Type.String({ description: "Task description" }),
				status: Type.Union([
					Type.Literal("pending"),
					Type.Literal("in_progress"),
					Type.Literal("completed"),
				]),
				priority: Type.Union([
					Type.Literal("high"),
					Type.Literal("medium"),
					Type.Literal("low"),
				]),
			})),
		}),
		async execute(_id, params) {
			writeTodos(sessionId, params.todos);
			const pending = params.todos.filter(t => t.status === "pending").length;
			const inProgress = params.todos.filter(t => t.status === "in_progress").length;
			const done = params.todos.filter(t => t.status === "completed").length;
			return {
				content: [{ type: "text", text: `Todo list updated: ${done} done, ${inProgress} in progress, ${pending} pending` }],
			};
		},
	});

	aery.registerTool({
		name: "TodoRead",
		description: "Read your current task list. Use to check what's pending and what's done.",
		parameters: Type.Object({}),
		async execute() {
			const todos = readTodos(sessionId);
			if (todos.length === 0) {
				return { content: [{ type: "text", text: "No todos" }] };
			}
			const formatted = todos.map(t => {
				const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "→" : "○";
				return `${icon} [${t.priority}] ${t.id}: ${t.content}`;
			}).join("\n");
			return { content: [{ type: "text", text: formatted }] };
		},
	});
}
