/**
 * Cron Scheduler — Parse cron expressions, run jobs, persist to disk.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CronJob, CronFields } from "./types.js";

const CONFIG_DIR = join(homedir(), ".aery", "agent");
const SCHEDULER_FILE = join(CONFIG_DIR, "scheduled_tasks.json");
const MAX_JOBS = 50;
const CHECK_INTERVAL = 30_000; // 30 seconds

// ─── Cron Parser ─────────────────────────────────────────────────────────────

function parseCronField(field: string, min: number, max: number): number[] {
	const values = new Set<number>();

	for (const part of field.split(",")) {
		if (part === "*") {
			for (let i = min; i <= max; i++) values.add(i);
		} else if (part.includes("/")) {
			const [range, step] = part.split("/");
			const stepNum = parseInt(step, 10);
			const start =
				range === "*" ? min : parseInt(range!.split("-")[0]!, 10);
			for (let i = start; i <= max; i += stepNum) values.add(i);
		} else if (part.includes("-")) {
			const [from, to] = part.split("-").map(Number);
			for (let i = from!; i <= to!; i++) values.add(i);
		} else {
			values.add(parseInt(part, 10));
		}
	}

	return [...values].sort((a, b) => a - b);
}

export function parseCronExpression(expr: string): CronFields | null {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return null;

	try {
		return {
			minute: parseCronField(parts[0]!, 0, 59),
			hour: parseCronField(parts[1]!, 0, 23),
			dayOfMonth: parseCronField(parts[2]!, 1, 31),
			month: parseCronField(parts[3]!, 1, 12),
			dayOfWeek: parseCronField(parts[4]!, 0, 6),
		};
	} catch {
		return null;
	}
}

export function matchesCron(fields: CronFields, date: Date): boolean {
	return (
		fields.minute.includes(date.getMinutes()) &&
		fields.hour.includes(date.getHours()) &&
		fields.dayOfMonth.includes(date.getDate()) &&
		fields.month.includes(date.getMonth() + 1) &&
		fields.dayOfWeek.includes(date.getDay())
	);
}

export function cronToHuman(expr: string): string {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return expr;

	const [min, hour, dom, month, dow] = parts;

	if (min === "*" && hour === "*") return "Every minute";
	if (hour === "*") return `Every hour at minute ${min}`;
	if (min === "*") return `Every minute during hour ${hour}`;

	const dowNames = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];
	const monthNames = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];

	let desc = `At ${hour!.padStart(2, "0")}:${min!.padStart(2, "0")}`;

	if (dom !== "*") desc += ` on day ${dom}`;
	if (month !== "*") {
		const m = parseInt(month!, 10);
		desc += ` in ${monthNames[m - 1] ?? month}`;
	}
	if (dow !== "*") {
		const d = parseInt(dow!, 10);
		desc += ` on ${dowNames[d] ?? dow}`;
	}

	return desc;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export interface CronScheduler {
	start(): void;
	stop(): void;
	addJob(
		cron: string,
		prompt: string,
		opts: { recurring: boolean; durable: boolean },
	): string;
	removeJob(id: string): boolean;
	listJobs(): CronJob[];
}

export function createCronScheduler(
	sendUserMessage: (msg: string) => void,
): CronScheduler {
	let jobs: CronJob[] = [];
	let interval: ReturnType<typeof setInterval> | undefined;

	function loadJobs(): void {
		try {
			if (existsSync(SCHEDULER_FILE)) {
				const raw = readFileSync(SCHEDULER_FILE, "utf-8");
				jobs = JSON.parse(raw);
			}
		} catch {
			jobs = [];
		}
	}

	function saveJobs(): void {
		try {
			if (!existsSync(CONFIG_DIR)) {
				mkdirSync(CONFIG_DIR, { recursive: true });
			}
			const durable = jobs.filter((j) => j.durable);
			writeFileSync(
				SCHEDULER_FILE,
				JSON.stringify(durable, null, 2),
			);
		} catch {
			// Best effort
		}
	}

	function checkJobs(): void {
		const now = new Date();
		const toRemove: string[] = [];

		for (const job of jobs) {
			const fields = parseCronExpression(job.cron);
			if (!fields) continue;

			if (matchesCron(fields, now)) {
				// Don't fire twice in the same minute
				if (job.lastFired) {
					const last = new Date(job.lastFired);
					if (
						now.getFullYear() === last.getFullYear() &&
						now.getMonth() === last.getMonth() &&
						now.getDate() === last.getDate() &&
						now.getHours() === last.getHours() &&
						now.getMinutes() === last.getMinutes()
					) {
						continue;
					}
				}

				job.lastFired = now.toISOString();
				sendUserMessage(
					`[Cron scheduled prompt] ${job.prompt}`,
				);

				if (!job.recurring) {
					toRemove.push(job.id);
				}
			}
		}

		if (toRemove.length > 0) {
			jobs = jobs.filter((j) => !toRemove.includes(j.id));
			saveJobs();
		}
	}

	return {
		start(): void {
			loadJobs();
			if (interval) return;
			interval = setInterval(checkJobs, CHECK_INTERVAL);
		},

		stop(): void {
			if (interval) {
				clearInterval(interval);
				interval = undefined;
			}
			saveJobs();
		},

		addJob(
			cron: string,
			prompt: string,
			opts: { recurring: boolean; durable: boolean },
		): string {
			if (jobs.length >= MAX_JOBS) {
				throw new Error(
					`Maximum of ${MAX_JOBS} scheduled jobs reached`,
				);
			}

			const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
			const job: CronJob = {
				id,
				cron,
				prompt,
				recurring: opts.recurring,
				durable: opts.durable,
				createdAt: new Date().toISOString(),
			};

			jobs.push(job);
			if (opts.durable) saveJobs();

			return id;
		},

		removeJob(id: string): boolean {
			const before = jobs.length;
			jobs = jobs.filter((j) => j.id !== id);
			if (jobs.length < before) {
				saveJobs();
				return true;
			}
			return false;
		},

		listJobs(): CronJob[] {
			return [...jobs];
		},
	};
}
