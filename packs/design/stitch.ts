/**
 * Google Stitch integration for Aery.
 *
 * Wraps @_davideast/stitch-mcp so Aery can inspect Stitch projects, fetch
 * generated screen code/images, and generate new design screens.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const STITCH_MCP_PACKAGE = "@_davideast/stitch-mcp";
const STITCH_TIMEOUT_MS = 120_000;

type StitchAuthMode = "api-key" | "gcloud" | "configured" | "missing";

export interface StitchAuthStatus {
	configured: boolean;
	mode: StitchAuthMode;
	projectId?: string;
}

export function getStitchAuthStatus(env: NodeJS.ProcessEnv = process.env): StitchAuthStatus {
	if (env.STITCH_API_KEY?.trim()) {
		return { configured: true, mode: "api-key", projectId: env.STITCH_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT };
	}
	if (env.STITCH_USE_SYSTEM_GCLOUD?.trim()) {
		return { configured: true, mode: "gcloud", projectId: env.STITCH_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT };
	}
	if (env.STITCH_PROJECT_ID?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim() || env.STITCH_ACCESS_TOKEN?.trim()) {
		return { configured: true, mode: "configured", projectId: env.STITCH_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT };
	}
	return { configured: false, mode: "missing" };
}

export function stitchSetupMessage(status = getStitchAuthStatus()): string {
	if (status.configured) {
		const project = status.projectId ? `, project ${status.projectId}` : "";
		return `Stitch auth configured via ${status.mode}${project}.`;
	}
	return [
		"Stitch is not configured.",
		"Run /stitch auth for guided setup, or set STITCH_API_KEY.",
		"For gcloud, set STITCH_USE_SYSTEM_GCLOUD=1 after configuring application-default credentials.",
	].join("\n");
}

export function buildStitchToolArgs(toolName: string, data: unknown): string[] {
	return ["-y", STITCH_MCP_PACKAGE, "tool", toolName, "-d", JSON.stringify(data ?? {})];
}

export function parseStitchCommand(input: string): { name: string; rest: string } {
	const trimmed = input.trim();
	if (!trimmed) return { name: "help", rest: "" };
	const [name = "help", ...parts] = trimmed.split(/\s+/);
	return { name: name.toLowerCase(), rest: parts.join(" ") };
}

function buildCommonEnv(): NodeJS.ProcessEnv {
	return { ...process.env };
}

async function runStitchCli(args: string[], timeout = STITCH_TIMEOUT_MS): Promise<string> {
	const { stdout, stderr } = await execFileAsync("npx", args, {
		env: buildCommonEnv(),
		timeout,
		maxBuffer: 10 * 1024 * 1024,
	});
	if (stderr && !stdout) throw new Error(stderr.trim());
	return stdout.trim();
}

async function callStitchTool(toolName: string, data: unknown): Promise<string> {
	const status = getStitchAuthStatus();
	if (!status.configured) throw new Error(stitchSetupMessage(status));
	return runStitchCli(buildStitchToolArgs(toolName, data));
}

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function parseJsonObject(input: string): Record<string, unknown> {
	if (!input.trim()) return {};
	try {
		const parsed = JSON.parse(input) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		return { value: parsed };
	} catch {
		return { value: input };
	}
}

function maybeImageResult(result: string, details: Record<string, unknown>) {
	let value = result.trim();
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		for (const key of ["data", "base64", "image", "imageBase64"]) {
			if (typeof parsed[key] === "string") {
				value = parsed[key] as string;
				break;
			}
		}
	} catch {}

	const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
	if (match) {
		return { content: [{ type: "image" as const, mimeType: match[1], data: match[2] }], details };
	}
	if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100) {
		return { content: [{ type: "image" as const, mimeType: "image/png", data: value.replace(/\s+/g, "") }], details };
	}
	return textResult(result, details);
}

export default function stitchExtension(aery: ExtensionAPI) {
	aery.on("session_start", (_event, ctx) => {
		const status = getStitchAuthStatus();
		if (!status.configured) {
			ctx.ui.notify("Stitch extension installed. Run /stitch auth before using Stitch tools.", "info");
		}
	});

	aery.registerTool({
		name: "stitch_list_projects",
		label: "Stitch: List Projects",
		description: "List Google Stitch projects available to the configured Stitch account.",
		promptSnippet: "Use stitch_list_projects to discover Stitch project IDs before fetching screens or code.",
		parameters: Type.Object({
			filter: Type.Optional(Type.String({ description: 'Optional Stitch filter, e.g. "view=owned" or "view=shared".' })),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("list_projects", params);
			return textResult(result, { tool: "list_projects" });
		},
	});

	aery.registerTool({
		name: "stitch_get_project",
		label: "Stitch: Get Project",
		description: "Get metadata for a Google Stitch project.",
		parameters: Type.Object({
			name: Type.String({ description: 'Project resource name, e.g. "projects/123456".' }),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("get_project", params);
			return textResult(result, { tool: "get_project" });
		},
	});

	aery.registerTool({
		name: "stitch_list_screens",
		label: "Stitch: List Screens",
		description: "List screens in a Google Stitch project.",
		promptSnippet: "Use stitch_list_screens after choosing a Stitch project to find screen IDs.",
		parameters: Type.Object({
			projectName: Type.String({ description: 'Project resource name, e.g. "projects/123456".' }),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("list_screens", params);
			return textResult(result, { tool: "list_screens" });
		},
	});

	aery.registerTool({
		name: "stitch_get_screen_code",
		label: "Stitch: Get Screen Code",
		description: "Fetch the generated HTML/CSS/frontend code for a Stitch screen.",
		promptSnippet: "Use stitch_get_screen_code before implementing a UI from an existing Stitch screen.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Numeric Stitch project ID." }),
			screenId: Type.String({ description: "Stitch screen ID." }),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("get_screen_code", params);
			return textResult(result, { tool: "get_screen_code" });
		},
	});

	aery.registerTool({
		name: "stitch_get_screen_image",
		label: "Stitch: Get Screen Image",
		description: "Fetch a screenshot for a Stitch screen.",
		promptSnippet: "Use stitch_get_screen_image to inspect the visual appearance of a Stitch screen.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Numeric Stitch project ID." }),
			screenId: Type.String({ description: "Stitch screen ID." }),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("get_screen_image", params);
			return maybeImageResult(result, { tool: "get_screen_image" });
		},
	});

	aery.registerTool({
		name: "stitch_extract_design_context",
		label: "Stitch: Extract Design Context",
		description: "Extract design DNA such as colors, typography, spacing, and layout patterns from a Stitch screen.",
		promptSnippet: "Use stitch_extract_design_context before generating a new Stitch screen that must match an existing design.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Numeric Stitch project ID." }),
			screenId: Type.String({ description: "Stitch screen ID." }),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("extract_design_context", params);
			return textResult(result, { tool: "extract_design_context" });
		},
	});

	aery.registerTool({
		name: "stitch_generate_screen",
		label: "Stitch: Generate Screen",
		description: "Generate a new Google Stitch screen from a prompt and optional design context.",
		promptSnippet: "Use stitch_generate_screen when the user asks Aery to create or iterate UI designs in Stitch.",
		parameters: Type.Object({
			prompt: Type.String({ description: "Natural-language design prompt for Stitch." }),
			projectId: Type.Optional(Type.String({ description: "Optional numeric Stitch project ID." })),
			context: Type.Optional(Type.String({ description: "Optional design context extracted from another screen." })),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("generate_screen_from_text", params);
			return textResult(result, { tool: "generate_screen_from_text" });
		},
	});

	aery.registerTool({
		name: "stitch_build_site",
		label: "Stitch: Build Site",
		description: "Map Stitch screens to routes and return page design HTML so Aery can implement a site.",
		promptSnippet: "Use stitch_build_site to turn selected Stitch screens into route-level implementation guidance.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Numeric Stitch project ID." }),
			routes: Type.Array(
				Type.Object({
					screenId: Type.String({ description: "Stitch screen ID." }),
					route: Type.String({ description: 'Route path, e.g. "/" or "/settings".' }),
				}),
				{ description: "Screen-to-route mapping." },
			),
		}),
		async execute(_id, params) {
			const result = await callStitchTool("build_site", params);
			return textResult(result, { tool: "build_site" });
		},
	});

	aery.registerTool({
		name: "stitch_call_tool",
		label: "Stitch: Call MCP Tool",
		description: "Call any Stitch MCP tool by name with a JSON object. Use only when a more specific Stitch tool is unavailable.",
		parameters: Type.Object({
			toolName: Type.String({ description: "Underlying Stitch MCP tool name." }),
			inputJson: Type.Optional(Type.String({ description: "JSON object payload for the tool." })),
		}),
		async execute(_id, params) {
			const payload = parseJsonObject(params.inputJson ?? "{}");
			const result = await callStitchTool(params.toolName, payload);
			return textResult(result, { tool: params.toolName });
		},
	});

	aery.registerCommand("stitch", {
		description: "Google Stitch integration. Usage: /stitch status | auth | doctor | projects | screens <project>",
		handler: async (args, ctx) => {
			const command = parseStitchCommand(args);

			if (command.name === "status") {
				ctx.ui.notify(stitchSetupMessage(), "info");
				return;
			}

			if (command.name === "auth" || command.name === "login" || command.name === "setup") {
				const choice = await ctx.ui.select("Set up Google Stitch", [
					"Guided setup with Stitch MCP",
					"API key instructions",
					"System gcloud instructions",
					"Cancel",
				]);
				if (!choice || choice === "Cancel") return;
				if (choice.startsWith("Guided")) {
					ctx.ui.notify("Starting Stitch MCP setup. Follow the terminal prompts.", "info");
					try {
						await execFileAsync("npx", ["-y", STITCH_MCP_PACKAGE, "init"], {
							env: buildCommonEnv(),
							timeout: 10 * 60_000,
							stdio: "inherit",
						} as Parameters<typeof execFileAsync>[2]);
						ctx.ui.notify("Stitch setup finished. Restart Aery if new environment variables were created.", "info");
					} catch (error) {
						ctx.ui.notify(`Stitch setup failed: ${error instanceof Error ? error.message : String(error)}`, "error");
					}
					return;
				}
				if (choice.startsWith("API")) {
					ctx.ui.notify(
						"Create a Stitch API key, then start Aery with STITCH_API_KEY set.\nExample: STITCH_API_KEY=... aery\nRun /stitch doctor after setup.",
						"info",
					);
					return;
				}
				ctx.ui.notify(
					[
						"Configure system gcloud for Stitch:",
						"gcloud auth application-default login",
						"gcloud config set project <PROJECT_ID>",
						"gcloud beta services mcp enable stitch.googleapis.com --project=<PROJECT_ID>",
						"Then start Aery with STITCH_USE_SYSTEM_GCLOUD=1.",
					].join("\n"),
					"info",
				);
				return;
			}

			if (command.name === "doctor") {
				ctx.ui.notify("Running Stitch doctor...", "info");
				try {
					ctx.ui.notify(await runStitchCli(["-y", STITCH_MCP_PACKAGE, "doctor"]), "info");
				} catch (error) {
					ctx.ui.notify(`Stitch doctor failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}

			if (command.name === "projects") {
				try {
					ctx.ui.notify(await callStitchTool("list_projects", {}), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}

			if (command.name === "screens") {
				if (!command.rest) {
					ctx.ui.notify('Usage: /stitch screens projects/<PROJECT_ID>', "warning");
					return;
				}
				try {
					ctx.ui.notify(await callStitchTool("list_screens", { projectName: command.rest }), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}

			ctx.ui.notify(
				[
					"Usage:",
					"  /stitch status",
					"  /stitch auth",
					"  /stitch doctor",
					"  /stitch projects",
					"  /stitch screens projects/<PROJECT_ID>",
				].join("\n"),
				"info",
			);
		},
	});
}
