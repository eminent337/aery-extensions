/**
 * SendMessage Tool
 *
 * Sends follow-up prompts to completed background agents by respawning them
 * with accumulated context from the previous run.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";
import type { Message } from "@eminent337/aery-ai";
import { type AgentScope, discoverAgents, loadAgentMemory } from "./agents.js";
import { completeBackgroundTask, findTaskByNameOrId, registerBackgroundTask } from "./background-tasks.js";

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: "aery", args };
}

/**
 * Register the SendMessage tool with the extension API.
 */
export function registerSendMessageTool(aery: ExtensionAPI): void {
	aery.registerTool({
		name: "SendMessage",
		description: [
			"Send a follow-up prompt to a completed background agent.",
			"The agent respawns with context from its previous run.",
			"Use to continue a worker after it completes, correct failures, or extend work.",
		].join(" "),
		promptSnippet: "send follow-up instructions to a background agent",
		promptGuidelines: [
			"Use SendMessage to continue a worker after it reports results",
			"The agent receives your prompt plus a summary of its previous work",
			"Workers can't see your conversation — include all context in the prompt",
		],
		parameters: {
			type: "object",
			properties: {
				to: {
					type: "string",
					description: "Agent name or task ID to send the message to",
				},
				prompt: {
					type: "string",
					description: "The follow-up prompt. Include all context — the agent can't see your conversation.",
				},
				agentScope: {
					type: "string",
					enum: ["user", "project", "both"],
					description: 'Agent directory scope. Default: "both"',
				},
			},
			required: ["to", "prompt"],
		},
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { to, prompt, agentScope: scopeParam } = params as {
				to: string;
				prompt: string;
				agentScope?: AgentScope;
			};
			const agentScope: AgentScope = scopeParam ?? "both";

			// Find the completed task
			const task = findTaskByNameOrId(to);
			if (!task) {
				return {
					content: [{ type: "text", text: `No agent found: "${to}". Use background_tasks to list active agents.` }],
					isError: true,
				};
			}

			if (task.status === "running") {
				return {
					content: [{ type: "text", text: `Agent "${task.agentName}" is still running. Use kill_background_task first if you want to restart it.` }],
					isError: true,
				};
			}

			// Discover agents to get the agent config
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agentConfig = discovery.agents.find((a) => a.name === task.agentName);

			if (!agentConfig) {
				return {
					content: [{ type: "text", text: `Agent definition not found for "${task.agentName}". It may have been removed.` }],
					isError: true,
				};
			}

			// Build accumulated context from previous run
			const previousOutput = task.result?.output || "(no output)";
			const contextSummary = [
				`[Context from previous run — agent "${task.agentName}" completed task: ${task.task}]`,
				`Previous result:\n${previousOutput}`,
				"",
				`[Follow-up prompt]`,
				prompt,
			].join("\n");

			// Spawn a new agent with the accumulated context
			const agentId = `send-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
			const outputFile = path.join(os.homedir(), ".aery", "agent", "agent-output", `${agentId}.json`);
			const outputDir = path.join(os.homedir(), ".aery", "agent", "agent-output");
			if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

			// Build the args for the new agent process
			const args: string[] = ["--mode", "json", "-p", "--no-session"];
			if (agentConfig.model) args.push("--model", agentConfig.model);
			if (agentConfig.tools && agentConfig.tools.length > 0) {
				args.push("--tools", agentConfig.tools.join(","));
			}

			// Write the system prompt to a temp file
			if (agentConfig.systemPrompt.trim()) {
				const memory = loadAgentMemory(agentConfig.name);
				const fullPrompt = memory
					? `<agent-memory>\n${memory}\n</agent-memory>\n\n${agentConfig.systemPrompt}`
					: agentConfig.systemPrompt;
				const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aery-sendmsg-"));
				const tmpPath = path.join(tmpDir, `prompt-${agentConfig.name}.md`);
				fs.writeFileSync(tmpPath, fullPrompt, { encoding: "utf-8", mode: 0o600 });
				args.push("--append-system-prompt", tmpPath);
			}

			args.push(`Task: ${contextSummary}`);

			// Launch in background
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: ctx.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			// Track the background task
			registerBackgroundTask(agentId, task.agentName, `SendMessage: ${prompt.slice(0, 80)}`, proc, outputFile);

			// Collect output
			let buffer = "";
			let stderr = "";
			const messages: Message[] = [];

			proc.stdout.on("data", (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						if (event.type === "message_end" && event.message) {
							messages.push(event.message as Message);
						}
					} catch {
						// ignore non-JSON lines
					}
				}
			});

			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on("close", (code: number | null) => {
				if (buffer.trim()) {
					try {
						const event = JSON.parse(buffer);
						if (event.type === "message_end" && event.message) {
							messages.push(event.message as Message);
						}
					} catch {
						// ignore
					}
				}

				const getFinalOutput = (msgs: Message[]): string => {
					for (let i = msgs.length - 1; i >= 0; i--) {
						const msg = msgs[i];
						if (msg.role === "assistant" && Array.isArray(msg.content)) {
							for (const part of msg.content) {
								if (part.type === "text") return part.text;
							}
						}
					}
					return "";
				};

				const output = getFinalOutput(messages);
				completeBackgroundTask(agentId, {
					output,
					exitCode: code ?? 0,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
				});

				try {
					fs.writeFileSync(outputFile, JSON.stringify({ output, exitCode: code, messages }, null, 2));
				} catch {
					// best effort
				}

				const status = code === 0 ? "completed" : "failed";
				aery.sendUserMessage(
					`<task-notification>\n<task-id>${agentId}</task-id>\n<status>${status}</status>\n<summary>SendMessage to "${task.agentName}" ${status}</summary>\n<result>${(output || "(no output)").slice(0, 2000)}</result>\n</task-notification>`
				).catch(() => {});
			});

			return {
				content: [{
					type: "text",
					text: `Sent follow-up to "${task.agentName}" (task: ${agentId}). Running in background.`,
				}],
			};
		},
	});
}
