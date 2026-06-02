import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";

// Code Review Agent — reviews file changes for bugs, security, and correctness
// Inspired by Codebuff's code_reviewer_deepseek_flash

const ReviewCodeParams = Type.Object({
	prompt: Type.String({
		description: "What to review — describe the changes, files, or area of code to focus on."
	}),
	files: Type.Optional(Type.Array(Type.String(), {
		description: "Specific file paths to review. If omitted, reviews based on prompt context."
	}))
});

export function registerCodeReviewerTool(aery: ExtensionAPI) {
	const reviewTool: ToolDefinition<typeof ReviewCodeParams, { prompt: string; files?: string[] }> = {
		name: "ReviewCode",
		label: "Code Review",
		description: "Review code changes and respond with critical feedback. Checks for: correctness, edge cases, error handling, security issues, style, and test coverage.",
		parameters: ReviewCodeParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let context = "";

			// Gather file contents for review
			if (params.files && params.files.length > 0) {
				for (const file of params.files) {
					try {
						const { exec } = await import("node:child_process");
						const { promisify } = await import("node:util");
						const execAsync = promisify(exec);
						const filePath = file.startsWith("/") ? file : `${ctx.cwd}/${file}`;
						const { stdout } = await execAsync(`cat "${filePath}"`).catch(() => ({ stdout: "" }));
						if (stdout) {
							context += `\n### ${file}\n\n\`\`\`\n${stdout.slice(0, 5000)}\n\`\`\`\n`;
						}
					} catch {}
				}
			}

			// Also try to get git diff
			try {
				const { exec } = await import("node:child_process");
				const { promisify } = await import("node:util");
				const execAsync = promisify(exec);
				const { stdout } = await execAsync("git diff HEAD", { cwd: ctx.cwd }).catch(() => ({ stdout: "" }));
				if (stdout && stdout.length < 15000) {
					context = `## Git Diff\n\n\`\`\`diff\n${stdout}\n\`\`\`\n\n` + context;
				}
			} catch {}

			return {
				content: [{ type: "text", text: context ? 
					`Review request: ${params.prompt}\n\nHere is the code to review:\n${context}` : 
					`Review request: ${params.prompt}`
				}],
			};
		}
	};

	aery.registerTool(reviewTool);
}
