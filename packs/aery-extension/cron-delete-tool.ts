/**
 * Cron Delete Tool — Remove a scheduled job.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";
import type { CronScheduler } from "./cron-scheduler.js";

export function registerCronDeleteTool(
	pi: ExtensionAPI,
	scheduler: CronScheduler,
): void {
	pi.registerTool({
		name: "cron_delete",
		description: "Remove a scheduled cron job by its ID.",
		parameters: Type.Object({
			id: Type.String({
				description: "The job ID returned by cron_create",
			}),
		}),
		async execute(_id, params) {
			const removed = scheduler.removeJob(params.id);
			if (removed) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Removed cron job: ${params.id}`,
						},
					],
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Job not found: ${params.id}`,
					},
				],
				isError: true,
			};
		},
	});
}
