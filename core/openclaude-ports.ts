import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// GlobTool
const GlobParams = Type.Object({
	pattern: Type.String({
		description: "The glob pattern to search for (e.g. '*.ts', 'src/**/*.js')."
	}),
	path: Type.Optional(Type.String({
		description: "The directory to search in. Defaults to the current working directory."
	}))
});

export function registerGlobTool(aery: ExtensionAPI) {
	const globTool: ToolDefinition<typeof GlobParams, { pattern: string; path?: string }> = {
		name: "GlobTool",
		label: "Glob Tool",
		description: "Fast file discovery using glob patterns. Use this to find files by wildcard without needing to write bash find commands.",
		parameters: GlobParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const targetDir = params.path || ctx.cwd;
			
			// Simple shell emulation of globbing using find
			// We translate common glob patterns to find arguments
			// For a fully robust glob, we'd use 'fast-glob' or similar, but this works natively.
			const cmd = `find "${targetDir}" -type f -name "${params.pattern.split('/').pop()}" | head -n 100`;
			
			try {
				const { stdout } = await execAsync(cmd);
				const files = stdout.split('\n').filter(Boolean);
				
				return {
					content: [{ type: "text", text: `Found ${files.length} files matching ${params.pattern}:\n${files.join('\n')}` }],
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error running GlobTool: ${err.message}` }],
					isError: true
				};
			}
		}
	};

	aery.registerTool(globTool);
}

// BriefTool
const BriefParams = Type.Object({
	message: Type.String({
		description: "The message for the user. Supports markdown formatting."
	}),
	attachments: Type.Optional(Type.Array(Type.String(), {
		description: "Optional file paths to attach (photos, diffs, logs) for the user to see."
	})),
	status: Type.Optional(Type.String({
		description: "'normal' or 'proactive'."
	}))
});

export function registerBriefTool(aery: ExtensionAPI) {
	const briefTool: ToolDefinition<typeof BriefParams, { message: string; attachments?: string[]; status?: string }> = {
		name: "BriefTool",
		label: "Brief Tool",
		description: "Send a structured brief or proactive message to the user, optionally with file attachments.",
		parameters: BriefParams,
		async execute(_id, params) {
			const attText = params.attachments?.length ? `\n\nAttachments:\n${params.attachments.map(a => `- ${a}`).join('\n')}` : '';
			
			return {
				content: [{ 
					type: "text", 
					text: `(Brief Delivered to User)\nMessage: ${params.message}${attText}`
				}],
				// We don't terminate the session, just log the brief
			};
		}
	};

	aery.registerTool(briefTool);
}

export default function openclaudePorts(aery: ExtensionAPI) {
    registerGlobTool(aery);
    registerBriefTool(aery);
}
