/**
 * Graphify extension for Aery
 * Turns any folder of files (code, docs, papers, images, video) into a
 * queryable knowledge graph with community detection and interactive HTML output.
 *
 * Source: https://github.com/safishamsi/graphify
 * Install graphify: pip install graphifyy
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "@sinclair/typebox";

async function ensureGraphify(exec: any): Promise<boolean> {
	try {
		const { exitCode } = await exec("python3", ["-m", "graphify", "--version"], { timeout: 5000 });
		return exitCode === 0;
	} catch {
		return false;
	}
}

async function installGraphify(exec: any): Promise<{ ok: boolean; error?: string }> {
	try {
		const { exitCode, stderr } = await exec("pip", ["install", "graphifyy", "--quiet"], { timeout: 60_000 });
		return exitCode === 0 ? { ok: true } : { ok: false, error: stderr };
	} catch (e: any) {
		return { ok: false, error: e.message };
	}
}

export default function (aery: ExtensionAPI) {
	// Register graphify as a tool the agent can call
	aery.registerTool({
		name: "graphify",
		description: "Build a knowledge graph from any folder of files (code, docs, papers, images, video). Outputs interactive HTML, GraphRAG-ready JSON, and a GRAPH_REPORT.md. Use when asked to analyze a codebase, understand architecture, map dependencies, or build a knowledge graph.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Path to analyze. Defaults to current directory." })),
			mode: Type.Optional(Type.String({ description: "Extraction mode: 'fast' (default) or 'deep' (richer edges)" })),
			update: Type.Optional(Type.Boolean({ description: "Incremental update — only re-process changed files" })),
			query: Type.Optional(Type.String({ description: "Query the existing graph instead of building it" })),
			explain: Type.Optional(Type.String({ description: "Explain a specific node/concept in the graph" })),
			no_viz: Type.Optional(Type.Boolean({ description: "Skip HTML visualization, just report + JSON" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: "Checking graphify installation..." }], details: {} });

			const installed = await ensureGraphify(ctx.exec);
			if (!installed) {
				onUpdate?.({ content: [{ type: "text", text: "Installing graphify (pip install graphifyy)..." }], details: {} });
				const result = await installGraphify(ctx.exec);
				if (!result.ok) {
					return {
						content: [{ type: "text" as const, text: `Failed to install graphify: ${result.error}\n\nInstall manually: pip install graphifyy` }],
						details: {},
						isError: true,
					};
				}
			}

			// Build the command
			const args: string[] = ["-m", "graphify"];

			if (params.query) {
				args.push("query", params.query);
			} else if (params.explain) {
				args.push("explain", params.explain);
			} else {
				args.push(params.path ?? ".");
				if (params.mode === "deep") args.push("--mode", "deep");
				if (params.update) args.push("--update");
				if (params.no_viz) args.push("--no-viz");
			}

			onUpdate?.({ content: [{ type: "text", text: `Running: python3 ${args.join(" ")}` }], details: {} });

			try {
				const { stdout, stderr, exitCode } = await ctx.exec("python3", args, { timeout: 300_000, signal });

				const output = stdout || stderr || "No output";
				const success = exitCode === 0;

				return {
					content: [{ type: "text" as const, text: success ? output : `graphify failed (exit ${exitCode}):\n${output}` }],
					details: { exitCode, path: params.path ?? "." },
					isError: !success,
				};
			} catch (e: any) {
				return {
					content: [{ type: "text" as const, text: `Error running graphify: ${e.message}` }],
					details: {},
					isError: true,
				};
			}
		},
	});

	// Register /graphify command for direct use
	aery.registerCommand("graphify", {
		description: "Build a knowledge graph from the current directory. Usage: /graphify [path] [--deep] [--update] [--no-viz]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const path = parts.find(p => !p.startsWith("--")) ?? ".";
			const deep = parts.includes("--deep");
			const update = parts.includes("--update");
			const noViz = parts.includes("--no-viz");

			ctx.ui.notify("Building knowledge graph...", "info");

			const installed = await ensureGraphify(ctx.exec);
			if (!installed) {
				ctx.ui.notify("Installing graphify...", "info");
				const result = await installGraphify(ctx.exec);
				if (!result.ok) {
					ctx.ui.notify(`Failed to install graphify: ${result.error}`, "error");
					return;
				}
			}

			const cmdArgs = ["-m", "graphify", path];
			if (deep) cmdArgs.push("--mode", "deep");
			if (update) cmdArgs.push("--update");
			if (noViz) cmdArgs.push("--no-viz");

			try {
				const { stdout, exitCode } = await ctx.exec("python3", cmdArgs, { timeout: 300_000 });
				if (exitCode === 0) {
					ctx.ui.notify("Knowledge graph built! See graphify-out/", "info");
					aery.sendUserMessage(`Graphify completed:\n\n${stdout}`);
				} else {
					ctx.ui.notify("Graphify failed — check output", "error");
					aery.sendUserMessage(`Graphify failed:\n\n${stdout}`);
				}
			} catch (e: any) {
				ctx.ui.notify(`Error: ${e.message}`, "error");
			}
		},
	});
}
