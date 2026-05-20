/**
 * Cron List Tool — List all scheduled jobs.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";
import { cronToHuman, type CronScheduler } from "./cron-scheduler.js";

export function registerCronListTool(
	pi: ExtensionAPI,
	scheduler: CronScheduler,
): void {
	pi.registerTool({
		name: "cron_list",
		description: "List all scheduled cron jobs.",
		parameters: Type.Object({}),
		async execute() {
			const jobs = scheduler.listJobs();

			if (jobs.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No scheduled jobs.",
						},
					],
				};
			}

			const lines = jobs.map((job) => {
				const human = cronToHuman(job.cron);
				const type = job.recurring ? "recurring" : "one-shot";
				const persist = job.durable ? "persistent" : "session-only";
				const lastFired = job.lastFired
					? ` (last: ${new Date(job.lastFired).toLocaleString()})`
					: "";
				return `- ${job.id}: ${human} [${type}, ${persist}] — "${job.prompt.slice(0, 60)}"${lastFired}`;
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Scheduled jobs (${jobs.length}):\n${lines.join("\n")}`,
					},
				],
				details: { count: jobs.length },
			};
		},
	});
}
