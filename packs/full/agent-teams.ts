/**
 * Aery Agent Teams
 * Full team protocol: config.json, task queue, inboxes, idle/shutdown.
 * Mirrors Claude Code's Agent Teams filesystem protocol.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "@sinclair/typebox";

const TEAMS_DIR = join(homedir(), ".aery", "teams");
const TASKS_DIR = join(homedir(), ".aery", "tasks");

interface TeamMember {
	agentId: string;
	name: string;
	agentType: "team-lead" | "general-purpose";
	joinedAt: number;
	cwd: string;
}

interface TeamConfig {
	name: string;
	description: string;
	createdAt: number;
	leadAgentId: string;
	members: TeamMember[];
}

interface Task {
	id: string;
	subject: string;
	description: string;
	status: "pending" | "in_progress" | "completed";
	owner?: string;
	blockedBy: string[];
	priority?: "high" | "medium" | "low";
}

interface InboxMessage {
	from: string;
	text: string;
	summary?: string;
	timestamp: string;
	read: boolean;
}

function ensureDirs(teamName: string) {
	[join(TEAMS_DIR, teamName, "inboxes"), join(TASKS_DIR, teamName)].forEach(d => {
		if (!existsSync(d)) mkdirSync(d, { recursive: true });
	});
}

function readConfig(teamName: string): TeamConfig | null {
	const path = join(TEAMS_DIR, teamName, "config.json");
	if (!existsSync(path)) return null;
	try { return JSON.parse(readFileSync(path, "utf-8")); }
	catch { return null; }
}

function writeConfig(teamName: string, config: TeamConfig) {
	writeFileSync(join(TEAMS_DIR, teamName, "config.json"), JSON.stringify(config, null, 2));
}

function readTasks(teamName: string): Task[] {
	const dir = join(TASKS_DIR, teamName);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter(f => f.endsWith(".json"))
		.map(f => JSON.parse(readFileSync(join(dir, f), "utf-8")) as Task);
}

function writeTask(teamName: string, task: Task) {
	writeFileSync(join(TASKS_DIR, teamName, `${task.id}.json`), JSON.stringify(task, null, 2));
}

function readInbox(teamName: string, agentName: string): InboxMessage[] {
	const path = join(TEAMS_DIR, teamName, "inboxes", `${agentName}.json`);
	if (!existsSync(path)) return [];
	try { return JSON.parse(readFileSync(path, "utf-8")); }
	catch { return []; }
}

function writeInbox(teamName: string, agentName: string, messages: InboxMessage[]) {
	writeFileSync(join(TEAMS_DIR, teamName, "inboxes", `${agentName}.json`), JSON.stringify(messages, null, 2));
}

function sendMessage(teamName: string, to: string, from: string, text: string, summary?: string) {
	const inbox = readInbox(teamName, to);
	inbox.push({ from, text, summary, timestamp: new Date().toISOString(), read: false });
	writeInbox(teamName, to, inbox);
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "TeamCreate",
		description: "Create a new agent team with a task queue. Returns team name.",
		parameters: Type.Object({
			name: Type.String({ description: "Team name (slug)" }),
			description: Type.String({ description: "What this team does" }),
			tasks: Type.Array(Type.Object({
				subject: Type.String(),
				description: Type.String(),
				priority: Type.Optional(Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")])),
				blockedBy: Type.Optional(Type.Array(Type.String())),
			})),
		}),
		async execute(_id, params) {
			ensureDirs(params.name);
			const config: TeamConfig = {
				name: params.name,
				description: params.description,
				createdAt: Date.now(),
				leadAgentId: `team-lead@${params.name}`,
				members: [{
					agentId: `team-lead@${params.name}`,
					name: "team-lead",
					agentType: "team-lead",
					joinedAt: Date.now(),
					cwd: process.cwd(),
				}],
			};
			writeConfig(params.name, config);

			// Create task files
			params.tasks.forEach((t, i) => {
				const task: Task = {
					id: String(i + 1),
					subject: t.subject,
					description: t.description,
					status: "pending",
					blockedBy: t.blockedBy || [],
					priority: t.priority || "medium",
				};
				writeTask(params.name, task);
			});

			return {
				content: [{ type: "text", text: `Team "${params.name}" created with ${params.tasks.length} tasks. Use TaskList to see available work.` }],
			};
		},
	});

	pi.registerTool({
		name: "TaskList",
		description: "List tasks in a team. Shows pending, in_progress, and completed tasks.",
		parameters: Type.Object({
			teamName: Type.String({ description: "Team name" }),
			filter: Type.Optional(Type.Union([
				Type.Literal("all"),
				Type.Literal("pending"),
				Type.Literal("in_progress"),
				Type.Literal("available"),
			])),
		}),
		async execute(_id, params) {
			const tasks = readTasks(params.teamName);
			const filter = params.filter || "all";

			let filtered = tasks;
			if (filter === "pending") filtered = tasks.filter(t => t.status === "pending");
			if (filter === "in_progress") filtered = tasks.filter(t => t.status === "in_progress");
			if (filter === "available") {
				const completedIds = new Set(tasks.filter(t => t.status === "completed").map(t => t.id));
				filtered = tasks.filter(t =>
					t.status === "pending" &&
					!t.owner &&
					t.blockedBy.every(id => completedIds.has(id))
				);
			}

			if (filtered.length === 0) return { content: [{ type: "text", text: `No ${filter} tasks` }] };

			const formatted = filtered.map(t => {
				const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "→" : "○";
				const owner = t.owner ? ` [${t.owner}]` : "";
				const blocked = t.blockedBy.length ? ` (blocked by: ${t.blockedBy.join(", ")})` : "";
				return `${icon} Task ${t.id}: ${t.subject}${owner}${blocked}`;
			}).join("\n");

			return { content: [{ type: "text", text: formatted }] };
		},
	});

	pi.registerTool({
		name: "TaskClaim",
		description: "Claim a task and mark it in_progress.",
		parameters: Type.Object({
			teamName: Type.String(),
			taskId: Type.String(),
			agentName: Type.String({ description: "Your agent name" }),
		}),
		async execute(_id, params) {
			const taskPath = join(TASKS_DIR, params.teamName, `${params.taskId}.json`);
			if (!existsSync(taskPath)) return { content: [{ type: "text", text: `Task ${params.taskId} not found` }] };
			const task: Task = JSON.parse(readFileSync(taskPath, "utf-8"));
			if (task.owner) return { content: [{ type: "text", text: `Task ${params.taskId} already claimed by ${task.owner}` }] };
			task.owner = params.agentName;
			task.status = "in_progress";
			writeTask(params.teamName, task);
			return { content: [{ type: "text", text: `Task ${params.taskId} claimed: ${task.subject}` }] };
		},
	});

	pi.registerTool({
		name: "TaskComplete",
		description: "Mark a task as completed.",
		parameters: Type.Object({
			teamName: Type.String(),
			taskId: Type.String(),
			result: Type.Optional(Type.String({ description: "Summary of what was done" })),
		}),
		async execute(_id, params) {
			const taskPath = join(TASKS_DIR, params.teamName, `${params.taskId}.json`);
			if (!existsSync(taskPath)) return { content: [{ type: "text", text: `Task ${params.taskId} not found` }] };
			const task: Task = JSON.parse(readFileSync(taskPath, "utf-8"));
			task.status = "completed";
			writeTask(params.teamName, task);
			if (params.result) {
				sendMessage(params.teamName, "team-lead", task.owner || "agent", params.result, `Task ${params.taskId} complete`);
			}
			return { content: [{ type: "text", text: `Task ${params.taskId} completed` }] };
		},
	});

	pi.registerTool({
		name: "TeamMessage",
		description: "Send a message to a team member's inbox.",
		parameters: Type.Object({
			teamName: Type.String(),
			to: Type.String({ description: "Recipient agent name" }),
			from: Type.String({ description: "Your agent name" }),
			message: Type.String(),
		}),
		async execute(_id, params) {
			ensureDirs(params.teamName);
			sendMessage(params.teamName, params.to, params.from, params.message);
			return { content: [{ type: "text", text: `Message sent to ${params.to}` }] };
		},
	});

	pi.registerTool({
		name: "TeamInbox",
		description: "Read your inbox messages from the team.",
		parameters: Type.Object({
			teamName: Type.String(),
			agentName: Type.String({ description: "Your agent name" }),
		}),
		async execute(_id, params) {
			const messages = readInbox(params.teamName, params.agentName);
			const unread = messages.filter(m => !m.read);
			if (unread.length === 0) return { content: [{ type: "text", text: "No new messages" }] };

			// Mark as read
			messages.forEach(m => m.read = true);
			writeInbox(params.teamName, params.agentName, messages);

			const formatted = unread.map(m => `[${m.from}] ${m.text}`).join("\n\n");
			return { content: [{ type: "text", text: formatted }] };
		},
	});

	pi.registerTool({
		name: "TeamDelete",
		description: "Delete a team and all its tasks/inboxes when work is complete.",
		parameters: Type.Object({
			teamName: Type.String(),
		}),
		async execute(_id, params) {
			const teamDir = join(TEAMS_DIR, params.teamName);
			const tasksDir = join(TASKS_DIR, params.teamName);
			if (existsSync(teamDir)) rmSync(teamDir, { recursive: true });
			if (existsSync(tasksDir)) rmSync(tasksDir, { recursive: true });
			return { content: [{ type: "text", text: `Team "${params.teamName}" deleted` }] };
		},
	});
}
