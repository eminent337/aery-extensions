/**
 * Graphify extension for Aery
 * Turns any folder of files (code, docs, papers, images, video) into a
 * queryable knowledge graph with community detection and interactive HTML output.
 *
 * Features:
 * - /graphify command for direct use
 * - graphify tool for agent use
 * - graphify_query tool for querying existing graphs
 * - Auto-loads graph summary on session start if graph.json exists
 *
 * Source: https://github.com/safishamsi/graphify
 * Requires: pip install graphifyy
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "@sinclair/typebox";

async function ensureGraphify(exec: any): Promise<boolean> {
	// Try graphify binary first (pipx install), then python3 -m graphify
	for (const [cmd, args] of [
		["graphify", ["--help"]],
		["/home/aryee/.local/bin/graphify", ["--help"]],
		[`${process.env.HOME}/.local/bin/graphify`, ["--help"]],
		["python3", ["-m", "graphify", "--help"]],
	] as [string, string[]][]) {
		try {
			const { exitCode } = await exec(cmd, args, { timeout: 5000 });
			if (exitCode === 0) return true;
		} catch { continue; }
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
		["pip", ["install", "graphifyy", "--quiet", "--break-system-packages"]],
		["pip", ["install", "graphifyy", "--quiet", "--user"]],
		["pipx", ["install", "graphifyy"]],
	] as [string, string[]][];

	for (const [cmd, args] of attempts) {
		try {
			const { exitCode } = await exec(cmd, args, { timeout: 60_000 });
			if (exitCode === 0) return { ok: true };
		} catch { continue; }
	}
	return { ok: false, error: "Could not install graphifyy automatically.\n\nTry one of:\n  pipx install graphifyy\n  python3 -m pip install graphifyy --break-system-packages\n  sudo apt install python3-pip && pip3 install graphifyy" };
}

function loadGraphSummary(cwd: string): string | null {
	const reportPath = join(cwd, "graphify-out", "GRAPH_REPORT.md");
	if (existsSync(reportPath)) {
		try {
			return readFileSync(reportPath, "utf-8").slice(0, 2000);
		} catch { return null; }
	}
	return null;
}

export default function (aery: ExtensionAPI) {

	let checkedDeps = false;

	// Auto-load graph summary on session start if present
	aery.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI || checkedDeps) return;
		checkedDeps = true;

		// Auto-load graph summary if present
		const cwd = ctx.sessionManager?.getCwd?.() ?? process.cwd();
		const summary = loadGraphSummary(cwd);
		if (summary && hasGraphify) {
			ctx.ui.notify("📊 Graphify knowledge graph found — loaded into context", "info");
			aery.sendUserMessage(
				`[graphify] Knowledge graph available for this project.\n\nGraph summary:\n${summary}\n\nUse the \`graphify_query\` tool to query the graph for specific questions.`,
				{ deliverAs: "system" } as any
			);
		}
	});

	// graphify tool — build the graph
	aery.registerTool({
		name: "graphify",
		description: "Build a knowledge graph from any folder of files (code, docs, papers, images, video). Outputs interactive HTML, GraphRAG-ready JSON, and GRAPH_REPORT.md. Use when asked to analyze a codebase, understand architecture, or map dependencies. For large codebases, prefer this over reading files individually.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Path to analyze. Defaults to current directory." })),
			mode: Type.Optional(Type.String({ description: "'fast' (default) or 'deep' (richer edges)" })),
			update: Type.Optional(Type.Boolean({ description: "Incremental — only re-process changed files" })),
			no_viz: Type.Optional(Type.Boolean({ description: "Skip HTML, just report + JSON" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: "Checking graphify..." }], details: {} });
			const installed = await ensureGraphify(aery.exec.bind(aery));
			if (!installed) {
				onUpdate?.({ content: [{ type: "text", text: "Installing graphify..." }], details: {} });
				const r = await installGraphify(aery.exec.bind(aery));
				if (!r.ok) return { content: [{ type: "text" as const, text: `Install failed: ${r.error}\nRun: pip install graphifyy` }], details: {}, isError: true };
			}

			const args = ["-m", "graphify", params.path ?? "."];
			if (params.mode === "deep") args.push("--mode", "deep");
			if (params.update) args.push("--update");
			if (params.no_viz) args.push("--no-viz");

			onUpdate?.({ content: [{ type: "text", text: `Building graph: ${args.join(" ")}` }], details: {} });

			try {
				const { stdout, stderr, exitCode } = await aery.exec("python3", args, { timeout: 300_000, signal });
				const out = stdout || stderr || "No output";
				return {
					content: [{ type: "text" as const, text: exitCode === 0 ? out : `Failed (exit ${exitCode}):\n${out}` }],
					details: { exitCode, path: params.path ?? "." },
					isError: exitCode !== 0,
				};
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], details: {}, isError: true };
			}
		},
	});

	// graphify_query tool — query existing graph
	aery.registerTool({
		name: "graphify_query",
		description: "Query an existing graphify knowledge graph. Use this instead of reading files when a graph.json exists. Much more token-efficient for large codebases.",
		parameters: Type.Object({
			question: Type.String({ description: "Question to ask the knowledge graph" }),
			path: Type.Optional(Type.String({ description: "Path where graphify-out/ exists. Defaults to current directory." })),
			mode: Type.Optional(Type.String({ description: "'bfs' (default, broad context) or 'dfs' (trace specific path)" })),
			budget: Type.Optional(Type.Number({ description: "Max tokens in answer (default: 1500)" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const graphPath = join(params.path ?? ".", "graphify-out", "graph.json");
			if (!existsSync(graphPath)) {
				return {
					content: [{ type: "text" as const, text: `No graph found at ${graphPath}. Run graphify first: /graphify ${params.path ?? "."}` }],
					details: {}, isError: true,
				};
			}

			const installed = await ensureGraphify(aery.exec.bind(aery));
			if (!installed) {
				const r = await installGraphify(aery.exec.bind(aery));
				if (!r.ok) return { content: [{ type: "text" as const, text: `Install failed: ${r.error}` }], details: {}, isError: true };
			}

			const args = ["-m", "graphify", "query", params.question];
			if (params.mode === "dfs") args.push("--dfs");
			if (params.budget) args.push("--budget", String(params.budget));

			onUpdate?.({ content: [{ type: "text", text: `Querying graph: "${params.question}"` }], details: {} });

			try {
				const { stdout, stderr, exitCode } = await aery.exec("python3", args, { timeout: 60_000, signal });
				const out = stdout || stderr || "No results";
				return {
					content: [{ type: "text" as const, text: out }],
					details: { exitCode, question: params.question },
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
			const deep = parts.includes("--deep");
			const update = parts.includes("--update");
			const noViz = parts.includes("--no-viz");

			ctx.ui.notify("Building knowledge graph...", "info");

			const installed = await ensureGraphify(aery.exec.bind(aery));
			if (!installed) {
				ctx.ui.notify("Installing graphify...", "info");
				const r = await installGraphify(aery.exec.bind(aery));
				if (!r.ok) { ctx.ui.notify(`Install failed: ${r.error}`, "error"); return; }
			}

			const cmdArgs = ["-m", "graphify", path];
			if (deep) cmdArgs.push("--mode", "deep");
			if (update) cmdArgs.push("--update");
			if (noViz) cmdArgs.push("--no-viz");

			try {
				const { stdout, exitCode } = await aery.exec("python3", cmdArgs, { timeout: 300_000 });
				if (exitCode === 0) {
					ctx.ui.notify("Knowledge graph built! See graphify-out/", "info");
					aery.sendUserMessage(`Graphify completed:\n\n${stdout}`);
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
