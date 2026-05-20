/**
 * Cron Create Tool — Schedule recurring or one-shot prompts.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";
import {
	parseCronExpression,
	cronToHuman,
	type CronScheduler,
} from "./cron-scheduler.js";

export function registerCronCreateTool(
	pi: ExtensionAPI,
	scheduler: CronScheduler,
): void {
	pi.registerTool({
		name: "cron_create",
		description:
			"Schedule a recurring or one-shot prompt using a standard 5-field cron expression.",
		promptSnippet: "schedule a recurring prompt",
		promptGuidelines: [
			"Use cron_create to schedule automated tasks or reminders",
			"Cron format: minute hour day-of-month month day-of-week",
			"Examples: '*/5 * * * *' (every 5 min), '0 9 * * 1-5' (weekdays at 9am)",
			"Set recurring=false for one-shot tasks that auto-delete after firing",
			"Set durable=true to persist across sessions (survives restarts)",
		],
		parameters: Type.Object({
			cron: Type.String({
				description:
					'Standard 5-field cron expression in local time: "M H DoM Mon DoW"',
			}),
			prompt: Type.String({
				description: "The prompt to enqueue at each fire time",
			}),
			recurring: Type.Optional(
				Type.Boolean({
					description:
						"true = fire on every match, false = fire once then auto-delete. Default: true",
				}),
			),
			durable: Type.Optional(
				Type.Boolean({
					description:
						"true = persist to disk and survive restarts, false = session-only. Default: false",
				}),
			),
		}),
		async execute(_id, params) {
			const fields = parseCronExpression(params.cron);
			if (!fields) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Invalid cron expression: ${params.cron}. Expected 5 fields: minute hour day-of-month month day-of-week`,
						},
					],
					isError: true,
				};
			}

			try {
				const id = scheduler.addJob(params.cron, params.prompt, {
					recurring: params.recurring ?? true,
					durable: params.durable ?? false,
				});

				const human = cronToHuman(params.cron);
				const recurring = params.recurring ?? true;
				const durable = params.durable ?? false;

				return {
					content: [
						{
							type: "text" as const,
							text: `Scheduled job ${id}: ${human} (${recurring ? "recurring" : "one-shot"}, ${durable ? "persistent" : "session-only"})`,
						},
					],
					details: {
						id,
						humanSchedule: human,
						recurring,
						durable,
					},
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to create cron job: ${(e as Error).message}`,
						},
					],
					isError: true,
				};
			}
		},
	});
}
