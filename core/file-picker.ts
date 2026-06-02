import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const FilePickerParams = Type.Object({
	prompt: Type.String({
		description: "A description of the files you need to find. Be descriptive about what the files contain or do."
	}),
	path: Type.Optional(Type.String({
		description: "Optional directory to search within. Defaults to the project root."
	})),
	maxResults: Type.Optional(Type.Number({
		description: "Maximum number of files to return. Default 12."
	})),
});

export function registerFilePickerTool(aery: ExtensionAPI) {
	const filePickerTool: ToolDefinition<typeof FilePickerParams, {
		prompt: string;
		path?: string;
		maxResults?: number;
	}> = {
		name: "FilePickerTool",
		label: "File Picker Tool",
		description: "Find relevant files in a codebase related to a description. Uses fuzzy search to find files by name, path patterns, and content analysis. Returns files with brief summaries.",
		parameters: FilePickerParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const targetDir = params.path || ctx.cwd;
			const maxFiles = params.maxResults || 12;
			const prompt = params.prompt.toLowerCase();

			const keywords = prompt
				.replace(/[^\w\s]/g, ' ')
				.split(/\s+/)
				.filter(w => w.length > 2)
				.filter(w => !['the', 'and', 'for', 'are', 'you', 'find', 'need', 'files', 'file', 'with', 'that', 'this', 'what', 'about'].includes(w));

			try {
				const nameMatches = new Set<string>();
				for (const keyword of keywords.slice(0, 5)) {
					try {
						const { stdout } = await execFileAsync("find", [
							targetDir, "-type", "f", "-iname", `*${keyword}*`,
							"!", "-path", "*/node_modules/*",
							"!", "-path", "*/.git/*",
							"!", "-path", "*/dist/*",
						], { timeout: 10000 });
						for (const file of stdout.split('\n').filter(Boolean)) {
							nameMatches.add(file);
						}
						if (nameMatches.size >= maxFiles * 4) break;
					} catch {}
				}

				const contentMatches = new Set<string>();
				if (keywords.length > 0) {
					for (const keyword of keywords.slice(0, 3)) {
						try {
							const { stdout } = await execFileAsync("rg", [
								"-i", "-l", keyword, targetDir,
								"-g", "*.{ts,tsx,js,jsx,py,go,rs,java,kt,swift,cpp,h,rb,php,cs}",
							], { timeout: 15000 });
							for (const file of stdout.split('\n').filter(Boolean)) {
								contentMatches.add(file);
							}
							if (contentMatches.size >= maxFiles * 4) break;
						} catch {}
					}
				}

				const scored = new Map<string, { name: boolean; content: boolean }>();
				for (const f of nameMatches) {
					if (!scored.has(f)) scored.set(f, { name: false, content: false });
					scored.get(f)!.name = true;
				}
				for (const f of contentMatches) {
					if (!scored.has(f)) scored.set(f, { name: false, content: false });
					scored.get(f)!.content = true;
				}

				const sorted = [...scored.entries()]
					.sort((a, b) => {
						const aScore = (a[1].name ? 2 : 0) + (a[1].content ? 1 : 0);
						const bScore = (b[1].name ? 2 : 0) + (b[1].content ? 1 : 0);
						return bScore - aScore;
					})
					.slice(0, maxFiles);

				if (sorted.length === 0) {
					return {
						content: [{ type: "text", text: "No relevant files found matching the description." }],
					};
				}

				let output = `Found ${sorted.length} relevant file(s) matching "${params.prompt}":\n\n`;
				for (const [file, score] of sorted) {
					const relPath = file.startsWith(ctx.cwd) ? file.substring(ctx.cwd.length + 1) : file;
					let summary = "";
					try {
						const firstLines = (await readFile(file, "utf-8")).split('\n').slice(0, 8).join('\n');
						const defLines = firstLines.split('\n')
							.filter(l => /^(export|function|class|interface|type|const|import|def|pub|fn)/.test(l.trim()))
							.slice(0, 4)
							.map(l => l.trim())
							.join('; ');
						summary = defLines ? `  Definitions: ${defLines}` : "";
					} catch {}

					const matchType = score.name ? "name match" : "content match";
					output += `- **${relPath}** (${matchType})\n${summary ? `  ${summary}\n` : ""}`;
				}

				return {
					content: [{ type: "text", text: output }],
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error searching files: ${err.message}` }],
					isError: true,
				};
			}
		}
	};

	aery.registerTool(filePickerTool);
}
