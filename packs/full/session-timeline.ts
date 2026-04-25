/**
 * Aery Session Timeline
 * Tracks all commands/events to timeline.jsonl, recovers context after compaction.
 */

import { existsSync, appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const TIMELINE_PATH = join(homedir(), ".aery", "agent", "timeline.jsonl");

interface TimelineEvent {
	timestamp: number;
	type: "command" | "tool_call" | "session_start" | "session_end" | "model_change";
	data: any;
}

const MAX_EVENTS = 1000;

function ensureTimeline() {
	const dir = join(homedir(), ".aery", "agent");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	if (!existsSync(TIMELINE_PATH)) appendFileSync(TIMELINE_PATH, "");
}

function pruneTimeline() {
	if (!existsSync(TIMELINE_PATH)) return;
	const lines = readFileSync(TIMELINE_PATH, "utf-8").trim().split("\n").filter(Boolean);
	if (lines.length > MAX_EVENTS) {
		writeFileSync(TIMELINE_PATH, lines.slice(-MAX_EVENTS).join("\n") + "\n");
	}
}

function logEvent(event: TimelineEvent) {
	ensureTimeline();
	appendFileSync(TIMELINE_PATH, JSON.stringify(event) + "\n");
}

function getRecentEvents(limit: number = 10): TimelineEvent[] {
	if (!existsSync(TIMELINE_PATH)) return [];
	const lines = readFileSync(TIMELINE_PATH, "utf-8").trim().split("\n").filter(Boolean);
	return lines.slice(-limit).map((line) => JSON.parse(line));
}

export default function (aery: ExtensionAPI) {
	aery.on("session_start", async (_event, ctx) => {
		logEvent({ timestamp: Date.now(), type: "session_start", data: { cwd: process.cwd() } });
		pruneTimeline();

		const recent = getRecentEvents(5);
		if (recent.length > 0) {
			const lastCommand = recent.reverse().find((e) => e.type === "command");
			if (lastCommand) {
				ctx.ui.notify(`Last session: ${lastCommand.data.name}`, "info");
			}
		}
	});

	// Inject context after compaction so LLM recovers state
	aery.on("session_compact", async (_event, ctx) => {
		logEvent({ timestamp: Date.now(), type: "session_start", data: { cwd: process.cwd(), reason: "post-compaction" } });

		const recent = getRecentEvents(10);
		if (recent.length === 0) return;

		const summary = recent
			.filter((e) => e.type === "command" || e.type === "tool_call")
			.slice(-5)
			.map((e) => {
				if (e.type === "command") return `• Command: /${e.data.name}`;
				if (e.type === "tool_call") return `• Tool: ${e.data.tool}`;
				return "";
			})
			.filter(Boolean)
			.join("\n");

		if (summary) {
			aery.sendUserMessage(
				`[Context recovered after compaction]\nRecent activity:\n${summary}\n\nContinue from where we left off.`,
			);
		}
	});

	aery.on("turn_end", async (_event, _ctx) => {
		logEvent({ timestamp: Date.now(), type: "session_end", data: {} });
	});

	aery.on("tool_call", async (event, _ctx) => {
		logEvent({
			timestamp: Date.now(),
			type: "tool_call",
			data: { tool: event.toolName, input: event.input },
		});
	});

	aery.on("model_changed", async (event, _ctx) => {
		logEvent({
			timestamp: Date.now(),
			type: "model_change",
			data: { model: (event as any).model?.id },
		});
	});

	aery.registerCommand("timeline", {
		description: "Show recent session timeline",
		handler: async (args, ctx) => {
			const limit = args ? parseInt(args) : 10;
			const events = getRecentEvents(limit);

			if (events.length === 0) {
				ctx.ui.notify("No timeline events", "info");
				return;
			}

			const formatted = events
				.map((e) => {
					const date = new Date(e.timestamp).toLocaleString();
					const type = e.type.padEnd(15);
					const data = JSON.stringify(e.data).slice(0, 50);
					return `${date} | ${type} | ${data}`;
				})
				.join("\n");

			aery.sendUserMessage(`Timeline (last ${events.length} events):\n\n${formatted}`);
		},
	});
}
