/**
 * Aery Loop Scheduler
 * /loop <interval> <prompt> — cron-style recurring agents
 * Examples:
 *   /loop 30m run the test suite and fix failures
 *   /loop 1h check for outdated packages
 *   /loop stop — stop all loops
 *   /loop list — list active loops
 */

import type { ExtensionAPI } from "@eminent337/aery";

interface LoopEntry {
	id: string;
	interval: number; // ms
	prompt: string;
	timer: ReturnType<typeof setInterval>;
	runs: number;
	lastRun?: number;
}

const loops = new Map<string, LoopEntry>();

function parseInterval(s: string): number | null {
	const m = s.match(/^(\d+)(s|m|h|d)$/);
	if (!m) return null;
	const n = parseInt(m[1]);
	const unit = m[2];
	if (unit === "s") return n * 1000;
	if (unit === "m") return n * 60 * 1000;
	if (unit === "h") return n * 3600 * 1000;
	if (unit === "d") return n * 86400 * 1000;
	return null;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("loop", {
		description: "Schedule recurring agent: /loop <interval> <prompt> | /loop stop [id] | /loop list",
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /loop <interval> <prompt> | /loop stop [id] | /loop list", "error");
				return;
			}

			// /loop list
			if (args.trim() === "list") {
				if (loops.size === 0) {
					ctx.ui.notify("No active loops", "info");
					return;
				}
				const list = Array.from(loops.values())
					.map((l) => `[${l.id}] every ${l.interval / 1000}s — ${l.prompt.slice(0, 50)} (runs: ${l.runs})`)
					.join("\n");
				pi.sendUserMessage(`Active loops:\n\n${list}`);
				return;
			}

			// /loop stop [id]
			if (args.startsWith("stop")) {
				const id = args.split(" ")[1];
				if (id) {
					const loop = loops.get(id);
					if (!loop) { ctx.ui.notify(`Loop ${id} not found`, "error"); return; }
					clearInterval(loop.timer);
					loops.delete(id);
					ctx.ui.notify(`Loop ${id} stopped`, "info");
				} else {
					loops.forEach((l) => clearInterval(l.timer));
					loops.clear();
					ctx.ui.notify("All loops stopped", "info");
				}
				return;
			}

			// /loop <interval> <prompt>
			const parts = args.split(" ");
			const intervalStr = parts[0];
			const prompt = parts.slice(1).join(" ");

			if (!prompt) {
				ctx.ui.notify("Usage: /loop <interval> <prompt>", "error");
				return;
			}

			const ms = parseInterval(intervalStr);
			if (!ms) {
				ctx.ui.notify("Invalid interval. Use: 30s, 5m, 1h, 1d", "error");
				return;
			}

			const id = `loop-${Date.now()}`;

			const timer = setInterval(async () => {
				const loop = loops.get(id);
				if (!loop) return;
				loop.runs++;
				loop.lastRun = Date.now();
				ctx.ui.notify(`Loop ${id} queued (run #${loop.runs}): ${prompt.slice(0, 40)}`, "info");
				// Wait for agent to finish current task before queuing next
				await ctx.waitForIdle();
				pi.sendUserMessage(`[Loop ${id}, run #${loop.runs}] ${prompt}`, { deliverAs: "followUp" });
			}, ms);

			loops.set(id, { id, interval: ms, prompt, timer, runs: 0 });
			ctx.ui.notify(`Loop ${id} started: every ${intervalStr} — ${prompt.slice(0, 40)}`, "info");
		},
	});

	// Clean up on shutdown
	pi.on("session_shutdown", async () => {
		loops.forEach((l) => clearInterval(l.timer));
		loops.clear();
	});
}
