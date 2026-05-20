/**
 * Monitor Tool — Run a shell command in the background and stream stdout.
 * Useful for watching builds, servers, log tails, etc.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function registerMonitorTool(pi: ExtensionAPI): void {
	const running = new Map<string, ChildProcess>();

	pi.registerTool({
		name: "monitor",
		description:
			"Run a shell command in the background and stream its stdout line-by-line as notifications. Use for watching builds, servers, log tails, or any long-running process.",
		promptSnippet: "watch a long-running process and stream its output",
		promptGuidelines: [
			"Use monitor to watch builds, servers, or log tails without blocking",
			"Unlike bash, monitor streams output continuously and returns immediately",
			"The agent receives each stdout line as a notification",
		],
		parameters: Type.Object({
			command: Type.String({
				description: "The shell command to run and monitor",
			}),
			description: Type.String({
				description:
					"Clear, concise description of what this command does in active voice",
			}),
		}),
		async execute(_id, params, signal, onUpdate) {
			const monitorId = `monitor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

			onUpdate?.({
				content: [
					{
						type: "text" as const,
						text: `Starting monitor: ${params.description}`,
					},
				],
				details: {},
			});

			return new Promise((resolve) => {
				const child = spawn("bash", ["-c", params.command], {
					stdio: ["ignore", "pipe", "pipe"],
					env: process.env,
				});

				running.set(monitorId, child);

				let lineCount = 0;
				const lines: string[] = [];

				const rl = createInterface({ input: child.stdout! });
				rl.on("line", (line) => {
					lineCount++;
					lines.push(line);
					// Keep only last 100 lines in memory
					if (lines.length > 100) lines.shift();

					onUpdate?.({
						content: [
							{
								type: "text" as const,
								text: `[${monitorId}] ${line}`,
							},
						],
						details: { lineCount },
					});
				});

				// Timeout
				const timer = setTimeout(() => {
					child.kill("SIGTERM");
				}, TIMEOUT_MS);

				// Abort signal
				signal?.addEventListener("abort", () => {
					child.kill("SIGTERM");
					clearTimeout(timer);
				});

				child.on("exit", (code, signal) => {
					clearTimeout(timer);
					running.delete(monitorId);

					const lastLines = lines.slice(-20).join("\n");
					const status = code !== null ? `exit code ${code}` : `killed by ${signal}`;

					resolve({
						content: [
							{
								type: "text" as const,
								text: `Monitor ${monitorId} finished (${status}). ${lineCount} lines captured.\n\nLast output:\n${lastLines}`,
							},
						],
						details: {
							monitorId,
							exitCode: code,
							lineCount,
						},
					});
				});

				child.on("error", (err) => {
					clearTimeout(timer);
					running.delete(monitorId);

					resolve({
						content: [
							{
								type: "text" as const,
								text: `Monitor failed to start: ${err.message}`,
							},
						],
						isError: true,
						details: { monitorId },
					});
				});
			});
		},
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", () => {
		for (const [id, child] of running) {
			try {
				child.kill("SIGTERM");
			} catch {
				// Best effort
			}
		}
		running.clear();
	});
}
