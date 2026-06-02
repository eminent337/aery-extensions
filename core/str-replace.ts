import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const StrReplaceParams = Type.Object({
	path: Type.String({
		description: "Path to the file to edit, relative to the project root."
	}),
	replacements: Type.Array(Type.Object({
		oldString: Type.String({
			description: "The exact string to replace. Must be an exact match including whitespace and punctuation."
		}),
		newString: Type.String({
			description: "The new string to replace the old string with. Can be empty to delete."
		}),
		allowMultiple: Type.Optional(Type.Boolean({
			description: "Whether to allow multiple replacements of oldString. Default false."
		}))
	}), {
		description: "Array of replacements to make in the file."
	})
});

export function registerStrReplaceTool(aery: ExtensionAPI) {
	const strReplaceTool: ToolDefinition<typeof StrReplaceParams, {
		path: string;
		replacements: { oldString: string; newString: string; allowMultiple?: boolean }[];
	}> = {
		name: "StrReplaceTool",
		label: "String Replace Tool",
		description: "Replace exact strings in a file with new content. Supports multiple replacements in a single call. Use this for targeted/surgical edits instead of rewriting entire files. Each replacement verifies the old string exists before replacing.",
		parameters: StrReplaceParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const filePath = path.isAbsolute(params.path) ? params.path : path.resolve(ctx.cwd, params.path);

			try {
				const content = await readFile(filePath, "utf-8");
				let modified = content;

				for (const r of params.replacements) {
					if (!r.allowMultiple) {
						const firstIdx = modified.indexOf(r.oldString);
						if (firstIdx === -1) {
							return {
								content: [{ type: "text", text: `Error: Could not find oldString "${r.oldString.substring(0, 50)}${r.oldString.length > 50 ? '...' : ''}" in ${filePath}.` }],
								isError: true,
							};
						}
						const secondIdx = modified.indexOf(r.oldString, firstIdx + 1);
						if (secondIdx !== -1) {
							return {
								content: [{ type: "text", text: `Error: Found multiple occurrences of oldString. Set allowMultiple: true or make the oldString more specific.` }],
								isError: true,
							};
						}
					}

					const count = modified.split(r.oldString).length - 1;
					modified = modified.split(r.oldString).join(r.newString);

					if (count === 0) {
						return {
							content: [{ type: "text", text: `Warning: oldString not found in ${filePath}.` }],
							isError: true,
						};
					}
				}

				await writeFile(filePath, modified, "utf-8");

				return {
					content: [{ type: "text", text: `Successfully applied ${params.replacements.length} replacement(s) to ${filePath}.` }],
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error editing ${filePath}: ${err.message}` }],
					isError: true,
				};
			}
		}
	};

	aery.registerTool(strReplaceTool);
}
