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

	// graphify tool — build the graph
	aery.registerTool({
		name: "graphify",
		description: "Build a knowledge graph from any folder of files (code, docs, papers, images, video). Use when asked to analyze a codebase, understand architecture, or map dependencies.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Path to analyze. Defaults to current directory." })),
			mode: Type.Optional(Type.String({ description: "'fast' (default) or 'deep'" })),
			update: Type.Optional(Type.Boolean({ description: "Incremental update only" })),
			no_viz: Type.Optional(Type.Boolean({ description: "Skip HTML visualization" })),
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
			const args = [...baseArgs, params.path ?? "."];
			if (params.mode === "deep") args.push("--mode", "deep");
			if (params.update) args.push("--update");
			if (params.no_viz) args.push("--no-viz");

			onUpdate?.({ content: [{ type: "text", text: `Building graph...` }], details: {} });

			try {
				const { stdout, stderr, exitCode } = await aery.exec(cmd, args, { timeout: 300_000, signal });
				const out = stdout || stderr || "No output";
				return {
					content: [{ type: "text" as const, text: exitCode === 0 ? out : `Failed:\n${out}` }],
					details: { exitCode, path: params.path ?? "." },
					isError: exitCode !== 0,
				};
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], details: {}, isError: true };
			}
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
		description: "Build a knowledge graph. Usage: /graphify [path] [--deep] [--update] [--no-viz]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const path = parts.find(p => !p.startsWith("--")) ?? ".";

			const installed = await isGraphifyInstalled();
			if (!installed) {
				ctx.ui.notify("Installing graphify...", "info");
				const r = await installGraphify(aery.exec.bind(aery));
				if (!r.ok) { ctx.ui.notify(`Install failed. Run: pipx install graphifyy`, "error"); return; }
			}

			const { cmd, baseArgs } = findGraphify();
			const cmdArgs = [...baseArgs, path];
			if (parts.includes("--deep")) cmdArgs.push("--mode", "deep");
			if (parts.includes("--update")) cmdArgs.push("--update");
			if (parts.includes("--no-viz")) cmdArgs.push("--no-viz");

			ctx.ui.notify("Building knowledge graph...", "info");
			try {
				const { stdout, exitCode } = await aery.exec(cmd, cmdArgs, { timeout: 300_000 });
				if (exitCode === 0) {
					ctx.ui.notify("✓ Knowledge graph built! See graphify-out/", "info");
				} else {
					ctx.ui.notify("Graphify failed", "error");
					aery.sendUserMessage(`Graphify failed:\n\n${stdout}`);
				}
			} catch (e: any) {
				ctx.ui.notify(`Error: ${e.message}`, "error");
			}
		},
	});
}
