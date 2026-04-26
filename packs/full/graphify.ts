/**
 * Graphify extension for Aery
 * Turns any folder of files into a queryable knowledge graph.
 * Source: https://github.com/safishamsi/graphify
 * Requires: pipx install graphifyy  OR  pip install graphifyy
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "@sinclair/typebox";

const REGISTRY_URL = "https://raw.githubusercontent.com/eminent337/aery-extensions/main/registry.json";

// Find graphify binary (handles pipx, pip --user, system installs)
function findGraphify(): { cmd: string; baseArgs: string[] } {
	const home = process.env.HOME || "";
	const candidates = [
		`${home}/.local/bin/graphify`,
		"/usr/local/bin/graphify",
		"/usr/bin/graphify",
	];
	for (const p of candidates) {
		if (existsSync(p)) return { cmd: p, baseArgs: [] };
	}
	// Fallback: python3 -m graphify
	return { cmd: "python3", baseArgs: ["-m", "graphify"] };
}

async function isGraphifyInstalled(): Promise<boolean> {
	const home = process.env.HOME || "";
	const candidates = [
		`${home}/.local/bin/graphify`,
		"/usr/local/bin/graphify",
		"/usr/bin/graphify",
	];
	for (const p of candidates) {
		if (existsSync(p)) return true;
	}
	return false;
}

async function installGraphify(exec: any): Promise<{ ok: boolean; error?: string }> {
	const attempts = [
		["python3", ["-m", "pip", "install", "graphifyy", "--quiet", "--break-system-packages"]],
		["python3", ["-m", "pip", "install", "graphifyy", "--quiet", "--user"]],
		["python3", ["-m", "pip", "install", "graphifyy", "--quiet"]],
		["pip3", ["install", "graphifyy", "--quiet", "--break-system-packages"]],
		["pip3", ["install", "graphifyy", "--quiet", "--user"]],
		["pip3", ["install", "graphifyy", "--quiet"]],
		["pipx", ["install", "graphifyy"]],
	] as [string, string[]][];

	for (const [cmd, args] of attempts) {
		try {
			const { exitCode } = await exec(cmd, args, { timeout: 60_000 });
			if (exitCode === 0) return { ok: true };
		} catch { continue; }
	}
	return { ok: false, error: "Could not install graphifyy automatically.\n\nTry:\n  pipx install graphifyy\n  python3 -m pip install graphifyy --break-system-packages" };
}

function loadGraphSummary(cwd: string): string | null {
	const reportPath = join(cwd, "graphify-out", "GRAPH_REPORT.md");
	if (existsSync(reportPath)) {
		try { return readFileSync(reportPath, "utf-8").slice(0, 2000); } catch {}
	}
	return null;
}

export default function (aery: ExtensionAPI) {
	let checkedDeps = false;

	aery.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI || checkedDeps) return;
		checkedDeps = true;

		// Auto-load graph summary if present
		const cwd = ctx.sessionManager?.getCwd?.() ?? process.cwd();
		const summary = loadGraphSummary(cwd);
		if (summary && await isGraphifyInstalled()) {
			ctx.ui.notify("📊 Graphify knowledge graph found", "info");
		}
	});

	// graphify tool — install skill and query
	aery.registerTool({
		name: "graphify",
		description: "Install the graphify skill for knowledge graph building, or query an existing graph. Graphify works by installing a skill that guides the agent to build knowledge graphs from codebases.",
		parameters: Type.Object({
			action: Type.String({ description: "'install' to set up graphify skill, 'query' to query existing graph, 'watch' to watch for changes" }),
			question: Type.Optional(Type.String({ description: "Question for query action" })),
			path: Type.Optional(Type.String({ description: "Path for watch action" })),
		}),
		async execute(_id, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: "Checking graphify..." }], details: {} });

			const installed = await isGraphifyInstalled();
			if (!installed) {
				onUpdate?.({ content: [{ type: "text", text: "Installing graphify..." }], details: {} });
				const r = await installGraphify(aery.exec.bind(aery));
				if (!r.ok) return { content: [{ type: "text" as const, text: `Install failed: ${r.error}` }], details: {}, isError: true };
			}

			const { cmd, baseArgs } = findGraphify();

			if (params.action === "query" && params.question) {
				const { stdout, exitCode } = await aery.exec(cmd, [...baseArgs, "query", params.question], { timeout: 60_000, signal });
				return { content: [{ type: "text" as const, text: stdout || "No results" }], details: { exitCode }, isError: exitCode !== 0 };
			}

			if (params.action === "watch" && params.path) {
				aery.exec(cmd, [...baseArgs, "watch", params.path], { timeout: 0 }).catch(() => {});
				return { content: [{ type: "text" as const, text: `Watching ${params.path} for changes...` }], details: {} };
			}

			// Default: install skill
			const { stdout, exitCode } = await aery.exec(cmd, [...baseArgs, "install", "--platform", "codex"], { timeout: 30_000, signal });
			return {
				content: [{ type: "text" as const, text: exitCode === 0 ? "Graphify skill installed. The agent will now build knowledge graphs automatically when analyzing codebases." : `Install failed:\n${stdout}` }],
				details: { exitCode },
				isError: exitCode !== 0,
			};
		},
	});

	// graphify_query tool
	aery.registerTool({
		name: "graphify_query",
		description: "Query an existing graphify knowledge graph. Token-efficient for large codebases.",
		parameters: Type.Object({
			question: Type.String({ description: "Question to ask the knowledge graph" }),
			path: Type.Optional(Type.String({ description: "Path where graphify-out/ exists." })),
			mode: Type.Optional(Type.String({ description: "'bfs' (default) or 'dfs'" })),
		}),
		async execute(_id, params, signal, onUpdate) {
			const graphPath = join(params.path ?? ".", "graphify-out", "graph.json");
			if (!existsSync(graphPath)) {
				return { content: [{ type: "text" as const, text: `No graph found. Run /graphify first.` }], details: {}, isError: true };
			}

			const { cmd, baseArgs } = findGraphify();
			const args = [...baseArgs, "query", params.question];
			if (params.mode === "dfs") args.push("--dfs");

			onUpdate?.({ content: [{ type: "text", text: `Querying: "${params.question}"` }], details: {} });

			try {
				const { stdout, stderr, exitCode } = await aery.exec(cmd, args, { timeout: 60_000, signal });
				return {
					content: [{ type: "text" as const, text: stdout || stderr || "No results" }],
					details: { exitCode },
					isError: exitCode !== 0,
				};
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], details: {}, isError: true };
			}
		},
	});

	// /graphify command
	aery.registerCommand("graphify", {
		description: "Install graphify skill or query the knowledge graph. Usage: /graphify [install|query \"question\"|watch <path>]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = parts[0] ?? "install";

			const installed = await isGraphifyInstalled();
			if (!installed) {
				ctx.ui.notify("Installing graphify...", "info");
				const r = await installGraphify(aery.exec.bind(aery));
				if (!r.ok) { ctx.ui.notify(`Install failed. Run: pipx install graphifyy`, "error"); return; }
			}

			const { cmd, baseArgs } = findGraphify();

			if (subcommand === "query") {
				const question = parts.slice(1).join(" ");
				if (!question) { ctx.ui.notify("Usage: /graphify query \"your question\"", "warning"); return; }
				ctx.ui.notify(`Querying graph...`, "info");
				try {
					const { stdout, exitCode } = await aery.exec(cmd, [...baseArgs, "query", question], { timeout: 60_000 });
					if (exitCode === 0) aery.sendUserMessage(`Graph query result:\n\n${stdout}`);
					else ctx.ui.notify("Query failed", "error");
				} catch (e: any) { ctx.ui.notify(`Error: ${e.message}`, "error"); }
				return;
			}

			if (subcommand === "watch") {
				const path = parts[1] ?? ".";
				ctx.ui.notify(`Starting graphify watch on ${path}...`, "info");
				aery.exec(cmd, [...baseArgs, "watch", path], { timeout: 0 }).catch(() => {});
				return;
			}

			// Default: install the skill for Aery (writes to AGENTS.md)
			ctx.ui.notify("Installing graphify skill for Aery...", "info");
			try {
				const { exitCode, stdout } = await aery.exec(cmd, [...baseArgs, "install", "--platform", "codex"], { timeout: 30_000 });
				if (exitCode === 0) {
					ctx.ui.notify("✓ Graphify skill installed! The agent will now build knowledge graphs automatically.", "info");
				} else {
					ctx.ui.notify("Skill install failed", "error");
				}
			} catch (e: any) {
				ctx.ui.notify(`Error: ${e.message}`, "error");
			}
		},
	});
}
