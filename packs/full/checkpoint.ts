/**
 * Aery Checkpoint System
 * Save/resume working state snapshots (git state, decisions, remaining work).
 */

import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@eminent337/aery";

const CHECKPOINTS_DIR = join(homedir(), ".aery", "agent", "checkpoints");

interface Checkpoint {
	id: string;
	timestamp: number;
	cwd: string;
	branch: string;
	commit: string;
	decisions: string[];
	remaining: string[];
	notes: string;
}

function ensureCheckpointsDir() {
	if (!existsSync(CHECKPOINTS_DIR)) mkdirSync(CHECKPOINTS_DIR, { recursive: true });
}

function getGitInfo(): { branch: string; commit: string } | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
		const commit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
		return { branch, commit };
	} catch {
		return null;
	}
}

function saveCheckpoint(checkpoint: Checkpoint) {
	ensureCheckpointsDir();
	const path = join(CHECKPOINTS_DIR, `${checkpoint.id}.json`);
	writeFileSync(path, JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint(id: string): Checkpoint | null {
	const path = join(CHECKPOINTS_DIR, `${id}.json`);
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf-8"));
}

function listCheckpoints(cwd?: string): Checkpoint[] {
	ensureCheckpointsDir();
	const files = readdirSync(CHECKPOINTS_DIR).filter((f) => f.endsWith(".json"));
	const checkpoints = files.map((f) => {
		const data = readFileSync(join(CHECKPOINTS_DIR, f), "utf-8");
		return JSON.parse(data) as Checkpoint;
	});
	return cwd ? checkpoints.filter((c) => c.cwd === cwd) : checkpoints;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("checkpoint", {
		description: "Save/load/list working state snapshots",
		handler: async (args, ctx) => {
			const [action, ...rest] = (args || "").split(" ");

			if (!action || action === "list") {
				const cwd = process.cwd();
				const checkpoints = listCheckpoints(cwd);

				if (checkpoints.length === 0) {
					ctx.ui.notify("No checkpoints for this project", "info");
					return;
				}

				const formatted = checkpoints
					.sort((a, b) => b.timestamp - a.timestamp)
					.map((c) => {
						const date = new Date(c.timestamp).toLocaleString();
						const decisions = c.decisions.length;
						const remaining = c.remaining.length;
						return `${c.id}: ${c.branch} (${date})\n  Decisions: ${decisions}, Remaining: ${remaining}\n  ${c.notes}`;
					})
					.join("\n\n");

				pi.sendUserMessage(`Checkpoints:\n\n${formatted}`);
				return;
			}

			if (action === "save") {
				const gitInfo = getGitInfo();
				if (!gitInfo) {
					ctx.ui.notify("Not in a git repository", "error");
					return;
				}

				const id = `cp-${Date.now()}`;
				const notes = rest.join(" ") || "No notes";

				// Extract decisions and remaining work from recent conversation
				const entries = ctx.sessionManager.getBranch();
				const recentMessages = entries
					.filter((e: any) => e.type === "message" && e.role === "assistant")
					.slice(-3)
					.map((e: any) => {
						const content = e.content ?? [];
						return content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
					})
					.join("\n");

				// Simple extraction: lines with "decided", "will", "next", "todo", "remaining"
				const decisions = recentMessages.split(/[.\n]/)
					.filter((s: string) => /decided|chose|going with|approved/i.test(s))
					.map((s: string) => s.trim())
					.filter(Boolean)
					.slice(0, 5);

				const remaining = recentMessages.split(/[.\n]/)
					.filter((s: string) => /next|todo|remaining|still need|will need/i.test(s))
					.map((s: string) => s.trim())
					.filter(Boolean)
					.slice(0, 5);

				const checkpoint: Checkpoint = {
					id,
					timestamp: Date.now(),
					cwd: process.cwd(),
					branch: gitInfo.branch,
					commit: gitInfo.commit,
					decisions,
					remaining,
					notes,
				};

				saveCheckpoint(checkpoint);
				ctx.ui.notify(`Checkpoint saved: ${id}`, "info");
				return;
			}

			if (action === "load") {
				const id = rest[0];
				if (!id) {
					ctx.ui.notify("Usage: /checkpoint load <id>", "error");
					return;
				}

				const checkpoint = loadCheckpoint(id);
				if (!checkpoint) {
					ctx.ui.notify(`Checkpoint not found: ${id}`, "error");
					return;
				}

				const summary = [
					`Checkpoint: ${checkpoint.id}`,
					`Branch: ${checkpoint.branch}`,
					`Commit: ${checkpoint.commit}`,
					`Notes: ${checkpoint.notes}`,
					`Decisions: ${checkpoint.decisions.length}`,
					`Remaining: ${checkpoint.remaining.length}`,
				].join("\n");

				pi.sendUserMessage(`Loaded checkpoint:\n\n${summary}`);
				return;
			}

			ctx.ui.notify("Usage: /checkpoint [save|load|list]", "error");
		},
	});
}
