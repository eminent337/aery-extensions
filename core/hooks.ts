/**
 * Aery Lifecycle Hooks Extension (Phase 1.2)
 *
 * Runs shell commands before/after tool calls.
 * Config: ~/.aery/agent/hooks.yaml
 *
 * Example hooks.yaml:
 *
 * PreToolUse:
 *   - tool: "bash"
 *     command: "echo '[hook] $TOOL_INPUT' >> ~/.aery/agent/hooks.log"
 *     if: "Bash(rm *)"        # optional: only fire on rm commands
 *   - tool: "write"
 *     command: "echo 'Writing: $TOOL_INPUT_PATH'"
 *
 * PostToolUse:
 *   - tool: "write"
 *     command: "git add -A 2>/dev/null || true"
 *     async: true             # fire-and-forget
 *
 * Stop:
 *   - command: "notify-send 'Aery' 'Agent finished' 2>/dev/null || true"
 *     async: true
 *
 * Exit code 2 from PreToolUse = block the tool call (stderr shown as reason).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@eminent337/aery";

interface HookEntry {
	tool?: string;
	type?: "command" | "prompt" | "http";
	command?: string;
	if?: string;
	async?: boolean;
	// prompt type
	prompt?: string;
	// http type
	url?: string;
	method?: string;
}

interface HooksConfig {
	PreToolUse?: HookEntry[];
	PostToolUse?: HookEntry[];
	Stop?: HookEntry[];
}

function loadHooks(): HooksConfig {
	const path = join(homedir(), ".aery", "agent", "hooks.yaml");
	if (!existsSync(path)) return {};
	try {
		// Minimal YAML parser for simple key: value and list structures
		const text = readFileSync(path, "utf-8");
		const result: HooksConfig = {};
		let currentSection: string | null = null;
		let currentEntry: HookEntry | null = null;

		for (const rawLine of text.split("\n")) {
			const line = rawLine.trimEnd();
			if (!line || line.startsWith("#")) continue;

			// Section header (no leading spaces)
			if (/^[A-Za-z]/.test(line) && line.endsWith(":")) {
				currentSection = line.slice(0, -1);
				(result as any)[currentSection] = [];
				currentEntry = null;
				continue;
			}

			if (!currentSection) continue;

			// New list item
			const listMatch = line.match(/^  - (.+)/);
			if (listMatch) {
				const rest = listMatch[1];
				currentEntry = {} as HookEntry;
				(result as any)[currentSection].push(currentEntry);
				const kv = rest.match(/^(\w+):\s*"?(.+?)"?$/);
				if (kv) (currentEntry as any)[kv[1]] = kv[2] === "true" ? true : kv[2] === "false" ? false : kv[2];
				continue;
			}

			// Continuation key: value
			if (currentEntry) {
				const kv = line.match(/^    (\w+):\s*"?(.+?)"?$/);
				if (kv) (currentEntry as any)[kv[1]] = kv[2] === "true" ? true : kv[2] === "false" ? false : kv[2];
			}
		}
		return result;
	} catch {
		return {};
	}
}

function matchesIf(ifCondition: string | undefined, toolName: string, toolInput: string): boolean {
	if (!ifCondition) return true;
	// Pattern: ToolName(glob) e.g. Bash(rm *) or Bash(git *)
	const m = ifCondition.match(/^(\w+)\((.+)\)$/);
	if (!m) return true;
	const [, name, pattern] = m;
	if (name.toLowerCase() !== toolName.toLowerCase()) return false;
	// Simple glob: * matches anything
	const regex = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
	return regex.test(toolInput);
}

function runHook(entry: HookEntry, env: Record<string, string>, ctx?: any): { blocked: boolean; reason: string } {
	const type = entry.type || "command";

	// Type: command (shell command)
	if (type === "command") {
		if (!entry.command) return { blocked: false, reason: "" };
		try {
			execSync(entry.command, {
				env: { ...process.env, ...env },
				shell: "/bin/bash",
				timeout: 10_000,
				stdio: ["ignore", "pipe", "pipe"],
			});
			return { blocked: false, reason: "" };
		} catch (err: any) {
			if (err.status === 2) {
				return { blocked: true, reason: (err.stderr?.toString() || "Hook blocked tool call").trim() };
			}
			return { blocked: false, reason: "" };
		}
	}

	// Type: prompt (send message to LLM)
	if (type === "prompt") {
		if (!entry.prompt || !ctx) return { blocked: false, reason: "" };
		const message = entry.prompt.replace(/\$(\w+)/g, (_, key) => env[key] || "");
		pi.sendUserMessage(message).catch(() => {});
		return { blocked: false, reason: "" };
	}

	// Type: http (fire HTTP request)
	if (type === "http") {
		if (!entry.url) return { blocked: false, reason: "" };
		const method = entry.method || "POST";
		const body = JSON.stringify(env);
		fetch(entry.url, { method, headers: { "Content-Type": "application/json" }, body })
			.catch(() => {});
		return { blocked: false, reason: "" };
	}

	return { blocked: false, reason: "" };
}

export default function (pi: ExtensionAPI) {
	let hooks: HooksConfig = {};

	pi.on("session_start", async () => {
		hooks = loadHooks();
	});

	// Reload hooks on /reload
	pi.registerCommand("aery-hooks-reload", {
		description: "Reload hooks.yaml (internal)",
		handler: async (_args, ctx) => {
			hooks = loadHooks();
			ctx.ui.notify("Hooks reloaded from ~/.aery/agent/hooks.yaml", "info");
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		const entries = hooks.PreToolUse ?? [];
		if (!entries.length) return;

		const toolName = event.toolName ?? "";
		const toolInput = JSON.stringify(event.input ?? {});
		const inputPath = (event.input as any)?.path ?? "";

		const env: Record<string, string> = {
			TOOL_NAME: toolName,
			TOOL_INPUT: toolInput,
			TOOL_INPUT_PATH: inputPath,
		};

		for (const entry of entries) {
			if (entry.tool && entry.tool !== toolName) continue;
			if (!matchesIf(entry.if, toolName, toolInput)) continue;

			if (entry.async) {
				try { 
					if (entry.type === "command" && entry.command) {
						execSync(entry.command, { env: { ...process.env, ...env }, shell: "/bin/bash", stdio: "ignore" });
					} else {
						runHook(entry, env, ctx);
					}
				} catch {}
			} else {
				const { blocked, reason } = runHook(entry, env, ctx);
				if (blocked) return { block: true, reason };
			}
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		const entries = hooks.PostToolUse ?? [];
		if (!entries.length) return;

		const toolName = event.toolName ?? "";
		const toolInput = JSON.stringify(event.input ?? {});
		const inputPath = (event.input as any)?.path ?? "";

		const env: Record<string, string> = {
			TOOL_NAME: toolName,
			TOOL_INPUT: toolInput,
			TOOL_INPUT_PATH: inputPath,
		};

		for (const entry of entries) {
			if (entry.tool && entry.tool !== toolName) continue;
			if (!matchesIf(entry.if, toolName, toolInput)) continue;

			if (entry.async) {
				try { runHook(entry, env, ctx); } catch {}
			} else {
				runHook(entry, env, ctx);
			}
		}
	});

	pi.on("turn_end", async (_event, _ctx) => {
		const entries = hooks.Stop ?? [];
		for (const entry of entries) {
			if (!entry.command) continue;
			try {
				execSync(entry.command, { env: process.env as any, shell: "/bin/bash", stdio: "ignore", timeout: 10_000 });
			} catch {}
		}
	});
}
