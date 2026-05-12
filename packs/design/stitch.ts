/**
 * Google Stitch integration for Aery.
 *
 * Wraps @_davideast/stitch-mcp so Aery can inspect Stitch projects, fetch
 * generated screen code/images, and generate new design screens.
 */

import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const STITCH_MCP_PACKAGE = "@_davideast/stitch-mcp";
const STITCH_MCP_HOST = "https://stitch.googleapis.com/mcp";
const STITCH_TIMEOUT_MS = 120_000;
const STITCH_CONFIG_PATH = join(homedir(), ".aery", "agent", "stitch.json");

type StitchAuthMode = "api-key" | "gcloud" | "configured" | "missing";

export interface StitchConfig {
	authMode?: "api-key" | "gcloud";
	apiKey?: string;
	projectId?: string;
	accessToken?: string;
}

export interface StitchAuthStatus {
	configured: boolean;
	mode: StitchAuthMode;
	projectId?: string;
}

export type StitchDirectAuth =
	| { kind: "api-key"; apiKey: string }
	| { kind: "access-token"; accessToken: string; projectId: string };

function loadStitchConfig(): StitchConfig {
	if (!existsSync(STITCH_CONFIG_PATH)) return {};
	try {
		const parsed = JSON.parse(readFileSync(STITCH_CONFIG_PATH, "utf-8")) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as StitchConfig) : {};
	} catch {
		return {};
	}
}

function saveStitchConfig(config: StitchConfig): void {
	mkdirSync(dirname(STITCH_CONFIG_PATH), { recursive: true });
	writeFileSync(STITCH_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
	try {
		chmodSync(STITCH_CONFIG_PATH, 0o600);
	} catch {}
}

export function getStitchAuthStatus(
	env: NodeJS.ProcessEnv = process.env,
	config: StitchConfig = loadStitchConfig(),
): StitchAuthStatus {
	if (env.STITCH_API_KEY?.trim()) {
		return { configured: true, mode: "api-key", projectId: env.STITCH_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT };
	}
	if (env.STITCH_USE_SYSTEM_GCLOUD?.trim()) {
		return { configured: true, mode: "gcloud", projectId: env.STITCH_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT };
	}
	if (env.STITCH_PROJECT_ID?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim() || env.STITCH_ACCESS_TOKEN?.trim()) {
		return { configured: true, mode: "configured", projectId: env.STITCH_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT };
	}
	if (config.authMode === "api-key" && config.apiKey?.trim()) {
		return { configured: true, mode: "api-key", projectId: config.projectId };
	}
	if (config.authMode === "gcloud") {
		return { configured: true, mode: "gcloud", projectId: config.projectId };
	}
	if (config.projectId?.trim() || config.accessToken?.trim()) {
		return { configured: true, mode: "configured", projectId: config.projectId };
	}
	return { configured: false, mode: "missing" };
}

export function buildStitchEnv(
	env: NodeJS.ProcessEnv = process.env,
	config: StitchConfig = loadStitchConfig(),
): NodeJS.ProcessEnv {
	const next = { ...env };
	if (!next.STITCH_API_KEY && config.apiKey) next.STITCH_API_KEY = config.apiKey;
	if (!next.STITCH_PROJECT_ID && config.projectId) next.STITCH_PROJECT_ID = config.projectId;
	if (!next.GOOGLE_CLOUD_PROJECT && config.projectId) next.GOOGLE_CLOUD_PROJECT = config.projectId;
	if (!next.STITCH_ACCESS_TOKEN && config.accessToken) next.STITCH_ACCESS_TOKEN = config.accessToken;
	if (!next.STITCH_USE_SYSTEM_GCLOUD && config.authMode === "gcloud") next.STITCH_USE_SYSTEM_GCLOUD = "1";
	return next;
}

export function getStitchDirectAuth(
	env: NodeJS.ProcessEnv = process.env,
	config: StitchConfig = loadStitchConfig(),
): StitchDirectAuth | undefined {
	const apiKey = env.STITCH_API_KEY?.trim() || config.apiKey?.trim();
	if (apiKey) return { kind: "api-key", apiKey };

	const accessToken = env.STITCH_ACCESS_TOKEN?.trim() || config.accessToken?.trim();
	const projectId = env.STITCH_PROJECT_ID?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim() || config.projectId?.trim();
	if (accessToken && projectId) return { kind: "access-token", accessToken, projectId };
	return undefined;
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

const STITCH_MENU = {
	apiKey: "Configure with API key",
	gcloud: "Configure with gcloud",
	guided: "Guided Stitch MCP setup",
	status: "Status",
	doctor: "Doctor",
	projects: "Projects",
	screens: "Screens in a project",
	cancel: "Cancel",
} as const;

export function stitchMainMenuOptions(): string[] {
	return [
		STITCH_MENU.apiKey,
		STITCH_MENU.gcloud,
		STITCH_MENU.guided,
		STITCH_MENU.status,
		STITCH_MENU.doctor,
		STITCH_MENU.projects,
		STITCH_MENU.screens,
		STITCH_MENU.cancel,
	];
}

export function buildStitchToolArgs(toolName: string, data: unknown): string[] {
	return ["-y", STITCH_MCP_PACKAGE, "tool", toolName, "-d", JSON.stringify(data ?? {})];
}

function projectIdFromValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const match = trimmed.match(/^projects\/([^/]+)(?:\/.*)?$/);
	return match ? match[1] : trimmed;
}

export function normalizeStitchToolPayload(toolName: string, data: unknown): Record<string, unknown> {
	const payload = data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
	const projectId = projectIdFromValue(payload.projectId ?? payload.projectName ?? payload.project ?? payload.name);
	if (projectId && ["list_screens", "get_screen", "generate_screen_from_text", "build_site"].includes(toolName)) {
		payload.projectId = projectId;
		delete payload.projectName;
		delete payload.project;
	}
	if (toolName === "get_screen" && typeof payload.screenId === "string" && !payload.name) {
		payload.name = `projects/${payload.projectId}/screens/${payload.screenId}`;
	}
	return payload;
}

export function formatStitchError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("#/$defs/ScreenInstance") || message.includes("can't resolve reference")) {
		return [
			"Stitch MCP CLI failed while resolving its tool schema.",
			"The saved Aery Stitch auth can still be valid; Aery will use the direct Stitch API when an API key or access token is configured.",
			"Run /stitch doctor to verify auth, then retry the Stitch command.",
		].join("\n");
	}
	return message;
}

export function parseStitchCommand(_input: string): { name: string; rest: string } {
	return { name: "menu", rest: "" };
}

function buildCommonEnv(): NodeJS.ProcessEnv {
	return buildStitchEnv();
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

function parseMcpTextContent(value: unknown): string {
	if (value && typeof value === "object" && "content" in value && Array.isArray((value as { content: unknown }).content)) {
		const content = (value as { content: Array<Record<string, unknown>> }).content;
		if (content.length === 1 && typeof content[0]?.text === "string") return content[0].text;
		return JSON.stringify(value, null, 2);
	}
	return JSON.stringify(value, null, 2);
}

function tryParseJsonObject(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {}
	return undefined;
}

async function callStitchApiTool(toolName: string, data: unknown): Promise<string> {
	const auth = getStitchDirectAuth();
	if (!auth) throw new Error("Direct Stitch API auth is not configured.");

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
	};
	if (auth.kind === "api-key") {
		headers["X-Goog-Api-Key"] = auth.apiKey;
	} else {
		headers.Authorization = `Bearer ${auth.accessToken}`;
		headers["X-Goog-User-Project"] = auth.projectId;
	}

	const response = await fetch(process.env.STITCH_HOST || STITCH_MCP_HOST, {
		method: "POST",
		headers,
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: toolName, arguments: normalizeStitchToolPayload(toolName, data) },
		}),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Stitch API request failed (${response.status}): ${text}`);
	const parsed = JSON.parse(text) as { error?: { message?: string }; result?: unknown };
	if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
	return parseMcpTextContent(parsed.result);
}

async function fetchDownloadUrl(url: string, asBase64 = false): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Stitch download failed (${response.status}): ${await response.text()}`);
	if (asBase64) {
		const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
		const data = Buffer.from(await response.arrayBuffer()).toString("base64");
		return `data:${mimeType};base64,${data}`;
	}
	return response.text();
}

async function callDirectStitchHelper(toolName: string, data: unknown): Promise<string> {
	if (toolName === "get_screen_code" || toolName === "get_screen_image") {
		const screenText = await callStitchApiTool("get_screen", normalizeStitchToolPayload("get_screen", data));
		const screen = tryParseJsonObject(screenText);
		const key = toolName === "get_screen_code" ? "htmlCode" : "screenshot";
		const file = screen?.[key] as { downloadUrl?: unknown } | undefined;
		if (typeof file?.downloadUrl !== "string") throw new Error(`Stitch screen response did not include ${key}.downloadUrl.`);
		return fetchDownloadUrl(file.downloadUrl, toolName === "get_screen_image");
	}
	if (toolName === "build_site") {
		const payload = normalizeStitchToolPayload("build_site", data);
		const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
		const routes = Array.isArray(payload.routes) ? payload.routes : [];
		if (!projectId) throw new Error("build_site requires projectId.");
		const pages = [];
		for (const route of routes) {
			if (!route || typeof route !== "object") continue;
			const routeConfig = route as Record<string, unknown>;
			if (typeof routeConfig.screenId !== "string" || typeof routeConfig.route !== "string") continue;
			const html = await callDirectStitchHelper("get_screen_code", { projectId, screenId: routeConfig.screenId });
			pages.push({ route: routeConfig.route, screenId: routeConfig.screenId, html });
		}
		return JSON.stringify({ projectId, pages }, null, 2);
	}
	return callStitchApiTool(toolName, data);
}

async function callStitchTool(toolName: string, data: unknown): Promise<string> {
	const status = getStitchAuthStatus();
	if (!status.configured) throw new Error(stitchSetupMessage(status));
	if (getStitchDirectAuth()) return callDirectStitchHelper(toolName, data);
	try {
		return await runStitchCli(buildStitchToolArgs(toolName, data));
	} catch (error) {
		throw new Error(formatStitchError(error));
	}
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
		description: "Open the Google Stitch integration menu.",
		handler: async (args, ctx) => {
			parseStitchCommand(args);
			const choice = await ctx.ui.select("Google Stitch", stitchMainMenuOptions());
			if (!choice || choice === STITCH_MENU.cancel) return;

			if (choice === STITCH_MENU.status) {
				ctx.ui.notify(stitchSetupMessage(), "info");
				return;
			}

			if (choice === STITCH_MENU.apiKey) {
				const apiKey = await ctx.ui.input("Enter Google Stitch API key:");
				if (apiKey === undefined) return;
				if (!apiKey.trim()) {
					ctx.ui.notify("Stitch API key is required.", "warning");
					return;
				}
				const projectId = await ctx.ui.input("Optional Google Cloud project ID:", process.env.GOOGLE_CLOUD_PROJECT ?? "");
				saveStitchConfig({
					...loadStitchConfig(),
					authMode: "api-key",
					apiKey: apiKey.trim(),
					projectId: projectId?.trim() || undefined,
				});
				ctx.ui.notify(`Saved Stitch API-key configuration to ${STITCH_CONFIG_PATH}.\nOpen /stitch and choose Doctor next.`, "info");
				return;
			}

			if (choice === STITCH_MENU.gcloud) {
				const projectId = await ctx.ui.input("Google Cloud project ID for Stitch:", process.env.GOOGLE_CLOUD_PROJECT ?? "");
				if (projectId === undefined) return;
				if (!projectId.trim()) {
					ctx.ui.notify("Google Cloud project ID is required for gcloud setup.", "warning");
					return;
				}
				saveStitchConfig({
					...loadStitchConfig(),
					authMode: "gcloud",
					projectId: projectId.trim(),
				});
				ctx.ui.notify(
					`Saved Stitch gcloud configuration to ${STITCH_CONFIG_PATH}.\nMake sure you have run: gcloud auth application-default login\nThen open /stitch and choose Doctor.`,
					"info",
				);
				return;
			}

			if (choice === STITCH_MENU.guided) {
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

			if (choice === STITCH_MENU.doctor) {
				ctx.ui.notify("Running Stitch doctor...", "info");
				try {
					ctx.ui.notify(await runStitchCli(["-y", STITCH_MCP_PACKAGE, "doctor"]), "info");
				} catch (error) {
					ctx.ui.notify(`Stitch doctor failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}

			if (choice === STITCH_MENU.projects) {
				try {
					ctx.ui.notify(await callStitchTool("list_projects", {}), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}

			if (choice === STITCH_MENU.screens) {
				const projectName = await ctx.ui.input("Project ID or projects/<PROJECT_ID>:");
				if (projectName === undefined) return;
				if (!projectName.trim()) {
					ctx.ui.notify("Project ID is required.", "warning");
					return;
				}
				try {
					ctx.ui.notify(await callStitchTool("list_screens", { projectName: projectName.trim() }), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
		},
	});
}
