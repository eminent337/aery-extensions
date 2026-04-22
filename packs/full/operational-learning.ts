/**
 * Aery Operational Learning
 * Auto-captures failures (CLI errors, gotchas), surfaces in future sessions.
 */

import { existsSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const LEARNINGS_PATH = join(homedir(), ".aery", "agent", "learnings.jsonl");

interface Learning {
	timestamp: number;
	category: "cli_error" | "gotcha" | "workaround" | "tip";
	context: string;
	lesson: string;
	cwd: string;
}

function ensureLearnings() {
	const dir = join(homedir(), ".aery", "agent");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	if (!existsSync(LEARNINGS_PATH)) appendFileSync(LEARNINGS_PATH, "");
}

function logLearning(learning: Learning) {
	ensureLearnings();
	appendFileSync(LEARNINGS_PATH, JSON.stringify(learning) + "\n");
}

function getLearnings(cwd?: string): Learning[] {
	if (!existsSync(LEARNINGS_PATH)) return [];
	const lines = readFileSync(LEARNINGS_PATH, "utf-8").trim().split("\n").filter(Boolean);
	const all = lines.map((line) => JSON.parse(line) as Learning);
	return cwd ? all.filter((l) => l.cwd === cwd) : all;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const cwd = process.cwd();
		const learnings = getLearnings(cwd);

		if (learnings.length >= 3) {
			const top3 = learnings.slice(-3);
			const summary = top3.map((l) => `• ${l.lesson}`).join("\n");
			ctx.ui.notify(`Learnings from previous sessions:\n${summary}`, "info");
		}
	});

	pi.on("tool_result", async (event, _ctx) => {
		if (event.toolName === "bash" && event.result) {
			const result = event.result as any;
			if (result.exitCode && result.exitCode !== 0) {
				const stderr = result.stderr || "";
				if (stderr.includes("ENOENT") || stderr.includes("command not found")) {
					logLearning({
						timestamp: Date.now(),
						category: "cli_error",
						context: JSON.stringify(event.input).slice(0, 100),
						lesson: `Command failed: ${stderr.slice(0, 100)}`,
						cwd: process.cwd(),
					});
				}
			}
		}
	});

	pi.registerCommand("learn", {
		description: "Record a learning/gotcha for future sessions",
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /learn <lesson>", "error");
				return;
			}

			logLearning({
				timestamp: Date.now(),
				category: "tip",
				context: "manual",
				lesson: args,
				cwd: process.cwd(),
			});

			ctx.ui.notify("Learning recorded", "info");
		},
	});

	pi.registerCommand("learnings", {
		description: "Show all learnings for this project",
		handler: async (args, ctx) => {
			const cwd = process.cwd();
			const learnings = getLearnings(cwd);

			if (learnings.length === 0) {
				ctx.ui.notify("No learnings recorded yet", "info");
				return;
			}

			const formatted = learnings
				.map((l, i) => {
					const date = new Date(l.timestamp).toLocaleDateString();
					return `${i + 1}. [${l.category}] ${l.lesson} (${date})`;
				})
				.join("\n");

			pi.sendUserMessage(`Learnings for this project (${learnings.length}):\n\n${formatted}`);
		},
	});
}
