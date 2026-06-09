import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CodeSearchParams = Type.Object({
	queries: Type.Array(Type.Object({
		pattern: Type.String({
			description: "The pattern to search for (regex supported via ripgrep)."
		}),
		glob: Type.Optional(Type.String({
			description: "Optional file glob filter (e.g. '*.ts', '*.go', '*.py')."
		})),
		maxResults: Type.Optional(Type.Number({
			description: "Maximum results per query per file. Default 15."
		})),
		contextLines: Type.Optional(Type.Number({
			description: "Number of context lines before/after each match. Default 0."
		})),
		caseSensitive: Type.Optional(Type.Boolean({
			description: "Whether the search is case-sensitive. Default false."
		}))
	}), {
		description: "Array of search queries to execute in parallel."
	}),
	path: Type.Optional(Type.String({
		description: "Directory to search within. Defaults to current working directory."
	})),
	maxTotalResults: Type.Optional(Type.Number({
		description: "Maximum total results across all queries. Default 250."
	}))
});

export function registerCodeSearchTool(aery: ExtensionAPI) {
	const codeSearchTool: ToolDefinition<typeof CodeSearchParams, {
		queries: { pattern: string; glob?: string; maxResults?: number; contextLines?: number; caseSensitive?: boolean }[];
		path?: string;
		maxTotalResults?: number;
	}> = {
		name: "CodeSearchTool",
		label: "Code Search Tool",
		description: "Search codebase using ripgrep with multiple queries in parallel. Supports regex patterns, file glob filters, context lines, and case-sensitive search.",
		parameters: CodeSearchParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const targetDir = params.path || ctx.cwd;
			const maxTotal = params.maxTotalResults || 250;
			const results: { query: string; file: string; lines: string[] }[] = [];
			let totalCount = 0;

			for (const q of params.queries) {
				if (totalCount >= maxTotal) break;

				const rgArgs: string[] = ["--no-heading", "--line-number", "--color", "never"];
				
				if (q.glob) {
					rgArgs.push("-g", q.glob);
				}
				if (q.contextLines && q.contextLines > 0) {
					rgArgs.push("-C", String(q.contextLines));
				}
				if (q.caseSensitive) {
					rgArgs.push("-s");
				} else {
					rgArgs.push("-i");
				}
				if (q.maxResults) {
					rgArgs.push("--max-count", String(q.maxResults));
				}

				rgArgs.push("--", q.pattern, targetDir);

				try {
					const { stdout } = await execFileAsync("rg", rgArgs, {
						maxBuffer: 1024 * 1024,
						timeout: 30000,
					});

					if (!stdout.trim()) {
						results.push({ query: q.pattern, file: "", lines: ["No matches found."] });
						continue;
					}

					const lines = stdout.trim().split('\n').slice(0, maxTotal - totalCount);
					totalCount += lines.length;

					const fileMap = new Map<string, string[]>();
					for (const line of lines) {
						const colonIdx = line.indexOf(':');
						if (colonIdx === -1) continue;
						const file = line.substring(0, colonIdx);
						const content = line.substring(colonIdx + 1);
						if (!fileMap.has(file)) {
							fileMap.set(file, []);
						}
						fileMap.get(file)!.push(content);
					}

					for (const [file, fileLines] of fileMap) {
						results.push({ query: q.pattern, file, lines: fileLines });
					}
				} catch (err: any) {
					if (err.code === 1) {
						results.push({ query: q.pattern, file: "", lines: ["No matches found."] });
					} else {
						results.push({ query: q.pattern, file: "", lines: [`Error: ${err.message}`] });
					}
				}
			}

			let output = "";
			let currentQuery = "";
			for (const r of results) {
				if (r.query !== currentQuery) {
					currentQuery = r.query;
					output += `\n## Query: "${r.query}"\n`;
				}
				if (r.file) {
					output += `\n### ${r.file}\n`;
					for (const line of r.lines) {
						output += `  ${line}\n`;
					}
				} else if (r.lines.length === 1 && r.lines[0] === "No matches found.") {
					output += "  No matches found.\n";
				}
			}

			if (totalCount >= maxTotal) {
				output += `\n\n(Results truncated at ${totalCount} lines. Narrow your search for more specific results.)`;
			}

			return {
				content: [{ type: "text", text: output || "No results found." }],
			};
		}
	};

	aery.registerTool(codeSearchTool);
}
