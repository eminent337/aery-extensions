/**
 * Aery Health Score
 * Runs project linters/tests, computes 0-10 score, tracks trends.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const HEALTH_DIR = join(homedir(), ".aery", "agent", "health");

interface HealthRecord {
	timestamp: number;
	cwd: string;
	score: number;
	checks: { name: string; passed: boolean; output: string }[];
}

function ensureDir() {
	if (!existsSync(HEALTH_DIR)) mkdirSync(HEALTH_DIR, { recursive: true });
}

function projectKey(cwd: string): string {
	return cwd.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
}

function saveRecord(record: HealthRecord) {
	ensureDir();
	const path = join(HEALTH_DIR, `${projectKey(record.cwd)}.jsonl`);
	const line = JSON.stringify(record) + "\n";
	const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
	const lines = existing.trim().split("\n").filter(Boolean);
	lines.push(line.trim());
	writeFileSync(path, lines.slice(-50).join("\n") + "\n"); // keep last 50
}

function loadHistory(cwd: string): HealthRecord[] {
	ensureDir();
	const path = join(HEALTH_DIR, `${projectKey(cwd)}.jsonl`);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function runCheck(
	aery: ExtensionAPI,
	name: string,
	cmd: string,
	args: string[],
): Promise<{ passed: boolean; output: string }> {
	try {
		const result = await aery.exec(cmd, args, { timeout: 30_000 });
		const passed = result.code === 0;
		return { passed, output: (result.stdout + result.stderr).trim().slice(0, 200) };
	} catch {
		return { passed: false, output: "command not found" };
	}
}

export default function (aery: ExtensionAPI) {
	aery.registerCommand("health", {
		description: "Run linters/tests, show 0-10 health score with trends",
		handler: async (args, ctx) => {
			const cwd = process.cwd();
			ctx.ui.notify("Running health checks...", "info");

			const checks: { name: string; passed: boolean; output: string }[] = [];

			// Detect and run available tools
			const pkg = existsSync(join(cwd, "package.json"))
				? JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"))
				: {};
			const scripts = pkg.scripts || {};
			const hasBun = existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"));
			const runner = hasBun ? "bun" : "npm";

			// TypeScript
			if (existsSync(join(cwd, "tsconfig.json"))) {
				checks.push({ name: "TypeScript", ...(await runCheck(aery, "TypeScript", "npx", ["tsc", "--noEmit"])) });
			}

			// Tests
			if (scripts.test) {
				checks.push({ name: "Tests", ...(await runCheck(aery, "Tests", runner, ["run", "test", "--", "--run"])) });
			}

			// Biome
			if (existsSync(join(cwd, "biome.json")) || existsSync(join(cwd, "biome.jsonc"))) {
				checks.push({ name: "Biome", ...(await runCheck(aery, "Biome", "npx", ["biome", "check", "."])) });
			}

			// ESLint
			if (existsSync(join(cwd, ".eslintrc.json")) || existsSync(join(cwd, "eslint.config.js")) || existsSync(join(cwd, "eslint.config.mjs"))) {
				checks.push({ name: "ESLint", ...(await runCheck(aery, "ESLint", "npx", ["eslint", ".", "--max-warnings=0"])) });
			}

			// Shellcheck
			const shFiles = await aery.exec("find", [".", "-name", "*.sh", "-maxdepth", "3"], { timeout: 5000 });
			if (shFiles.stdout.trim()) {
				checks.push({ name: "Shellcheck", ...(await runCheck(aery, "Shellcheck", "shellcheck", shFiles.stdout.trim().split("\n"))) });
			}

			if (checks.length === 0) {
				ctx.ui.notify("No checks found (no tsconfig.json, package.json scripts, biome, eslint)", "warning");
				return;
			}

			// Score: 10 * (passed / total)
			const passed = checks.filter((c) => c.passed).length;
			const score = Math.round((passed / checks.length) * 10);

			// Save record
			const record: HealthRecord = { timestamp: Date.now(), cwd, score, checks };
			saveRecord(record);

			// Trend
			const history = loadHistory(cwd);
			const prev = history.length >= 2 ? history[history.length - 2].score : null;
			const trend = prev === null ? "" : score > prev ? ` ↑ (was ${prev})` : score < prev ? ` ↓ (was ${prev})` : " → (unchanged)";

			// Format output
			const lines = [
				`Health Score: ${score}/10${trend}`,
				``,
				...checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.name}${c.passed ? "" : `\n  ${c.output}`}`),
			];

			aery.sendUserMessage(lines.join("\n"));
		},
	});
}
