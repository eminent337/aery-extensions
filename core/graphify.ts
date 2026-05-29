import { readFileSync } from "node:fs";
import * as path from "node:path";
import { globSync } from "glob";
import type { ExtensionAPI } from "@aryee337/aery";
import { Type } from "typebox";

export default function graphifyExtension(aery: ExtensionAPI) {
	// We build the graph lazily or on-demand
	let graph: Map<string, { imports: string[]; importedBy: string[] }> | null = null;

	function buildGraph(cwd: string) {
		if (graph) return graph;
		graph = new Map();

		// 1. Find all files
		const files = globSync("**/*.{ts,js,tsx,jsx,mjs,cjs}", {
			cwd,
			ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
			absolute: true,
		});

		// Initialize nodes
		for (const file of files) {
			graph.set(file, { imports: [], importedBy: [] });
		}

		const importRegex = /(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g;

		// 2. Parse imports
		for (const file of files) {
			try {
				const content = readFileSync(file, "utf8");
				let match;
				while ((match = importRegex.exec(content)) !== null) {
					const importPath = match[1] || match[2];
					if (!importPath || !importPath.startsWith(".")) continue; // Skip external packages

					// Resolve relative import to absolute path
					const resolvedPath = path.resolve(path.dirname(file), importPath);

					// Simple heuristic to match without extensions
					const targetFile = files.find(
						(f) =>
							f.startsWith(resolvedPath) &&
							(f === resolvedPath ||
								f.startsWith(resolvedPath + ".") ||
								f.startsWith(resolvedPath + "/index.")),
					);

					if (targetFile) {
						graph.get(file)!.imports.push(targetFile);
						graph.get(targetFile)!.importedBy.push(file);
					}
				}
			} catch {
				// Ignore read errors
			}
		}
		return graph;
	}

	// Helper to get relative paths for display
	function rel(p: string, cwd: string) {
		return path.relative(cwd, p);
	}

	aery.registerTool({
		name: "query_graph",
		description: "Explore the dependency graph of a specific file to see what it imports and what depends on it.",
		parameters: Type.Object({
			file: Type.String({ description: "Relative path to the file to inspect" }),
		}),
		async execute(_id, args, _signal, _onUpdate, ctx) {
			const g = buildGraph(ctx.cwd);
			const absPath = path.resolve(ctx.cwd, args.file);

			// Try to find the file
			const target = Array.from(g.keys()).find((f) => f === absPath || rel(f, ctx.cwd) === args.file);

			if (!target || !g.has(target)) {
				return { content: [{ type: "text", text: `File not found in graph: ${args.file}` }] };
			}

			const node = g.get(target)!;
			const outgoing = node.imports.map((f) => rel(f, ctx.cwd));
			const incoming = node.importedBy.map((f) => rel(f, ctx.cwd));

			return {
				content: [
					{
						type: "text",
						text:
							`Graph for ${rel(target, ctx.cwd)}:\n\n` +
							`Depends on (${outgoing.length}):\n${outgoing.map((f) => `- ${f}`).join("\n") || "None"}\n\n` +
							`Imported by (${incoming.length}):\n${incoming.map((f) => `- ${f}`).join("\n") || "None"}`,
					},
				],
			};
		},
	});

	aery.registerTool({
		name: "god_nodes",
		description: "Identify 'God Nodes' in the codebase - highly connected files with the most incoming dependencies.",
		parameters: Type.Object({
			topK: Type.Optional(Type.Number({ description: "Number of nodes to return (default: 10)", default: 10 })),
		}),
		async execute(_id, args, _signal, _onUpdate, ctx) {
			const g = buildGraph(ctx.cwd);
			const topK = args.topK ?? 10;

			const nodes = Array.from(g.entries())
				.map(([file, data]) => ({ file, incoming: data.importedBy.length, outgoing: data.imports.length }))
				.sort((a, b) => b.incoming - a.incoming)
				.slice(0, topK);

			const result = nodes
				.map((n) => `- ${rel(n.file, ctx.cwd)} (Imported by: ${n.incoming}, Depends on: ${n.outgoing})`)
				.join("\n");

			return { content: [{ type: "text", text: `Top ${topK} God Nodes:\n\n${result}` }] };
		},
	});

	aery.registerTool({
		name: "graph_path",
		description: "Find the shortest dependency path between two files to understand their architectural relationship.",
		parameters: Type.Object({
			source: Type.String({ description: "Relative path to the source file" }),
			target: Type.String({ description: "Relative path to the target file" }),
		}),
		async execute(_id, args, _signal, _onUpdate, ctx) {
			const g = buildGraph(ctx.cwd);

			const srcNode = Array.from(g.keys()).find(
				(f) => rel(f, ctx.cwd) === args.source || f === path.resolve(ctx.cwd, args.source),
			);
			const tgtNode = Array.from(g.keys()).find(
				(f) => rel(f, ctx.cwd) === args.target || f === path.resolve(ctx.cwd, args.target),
			);

			if (!srcNode) return { content: [{ type: "text", text: `Source file not found: ${args.source}` }] };
			if (!tgtNode) return { content: [{ type: "text", text: `Target file not found: ${args.target}` }] };

			// BFS
			const queue: { file: string; path: string[] }[] = [{ file: srcNode, path: [srcNode] }];
			const visited = new Set<string>([srcNode]);

			while (queue.length > 0) {
				const { file, path: currentPath } = queue.shift()!;

				if (file === tgtNode) {
					const formattedPath = currentPath.map((f) => rel(f, ctx.cwd)).join(" ->\n");
					return { content: [{ type: "text", text: `Shortest dependency path:\n\n${formattedPath}` }] };
				}

				for (const neighbor of g.get(file)!.imports) {
					if (!visited.has(neighbor)) {
						visited.add(neighbor);
						queue.push({ file: neighbor, path: [...currentPath, neighbor] });
					}
				}
			}

			return {
				content: [
					{
						type: "text",
						text: `No dependency path found from ${args.source} to ${args.target}. They are architecturally disconnected.`,
					},
				],
			};
		},
	});
}
