/**
 * Coordination Enhancements Extension
 *
 * Provider-agnostic improvements for multi-agent coordination:
 * 1. Context summarization — summarize parent's conversation for fork children
 * 2. Task decomposition — guidance for breaking work into focused sub-tasks
 * 3. Result synthesis — combine findings into coherent summary
 * 4. Agent memory — persist what agents learn across sessions
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@aryee337/aery";

// ─── Constants ───────────────────────────────────────────────────────────────

const MEMORY_DIR = join(homedir(), ".aery", "agent", "agent-memory");
const INSIGHTS_DIR = join(homedir(), ".aery", "agent", "agent-insights");

// ─── Agent Memory ────────────────────────────────────────────────────────────

interface AgentMemory {
	agent: string;
	insights: string[];
	lastUpdated: string;
	taskCount: number;
}

function getMemoryPath(agentName: string): string {
	return join(MEMORY_DIR, agentName, "MEMORY.md");
}

function loadAgentMemory(agentName: string): string | null {
	try {
		const path = getMemoryPath(agentName);
		if (!existsSync(path)) return null;
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

function saveAgentMemory(agentName: string, insight: string): void {
	try {
		const dir = join(MEMORY_DIR, agentName);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const path = getMemoryPath(agentName);
		const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";

		// Add new insight with timestamp
		const timestamp = new Date().toISOString().split("T")[0];
		const entry = `\n- [${timestamp}] ${insight}`;

		// Keep memory under 5000 chars
		let updated = existing + entry;
		if (updated.length > 5000) {
			// Remove oldest entries
			const lines = updated.split("\n").filter((l) => l.trim());
			updated = lines.slice(-50).join("\n");
		}

		writeFileSync(path, updated);
	} catch {
		// Best effort
	}
}

// ─── Context Summarization ───────────────────────────────────────────────────

function summarizeConversation(messages: Array<{ role: string; content: any }>): string {
	const summary: string[] = [];

	// Extract key information from conversation
	for (const msg of messages) {
		if (msg.role === "assistant") {
			// Extract text content from assistant messages
			if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "text" && part.text) {
						// Keep first 200 chars of each assistant message
						const text = part.text.slice(0, 200);
						if (text.trim()) summary.push(text);
					}
				}
			}
		} else if (msg.role === "toolResult") {
			// Extract key findings from tool results
			if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "text" && part.text) {
						// Keep first 100 chars of tool results
						const text = part.text.slice(0, 100);
						if (text.trim()) summary.push(`[Tool: ${text}]`);
					}
				}
			}
		}
	}

	// Limit summary to 2000 chars
	const fullSummary = summary.join("\n");
	if (fullSummary.length > 2000) {
		return fullSummary.slice(0, 2000) + "\n... (truncated)";
	}

	return fullSummary;
}

// ─── Task Decomposition Guidance ─────────────────────────────────────────────

const TASK_DECOMPOSITION_GUIDANCE = `
## Task Decomposition

When receiving a complex task, break it down into focused sub-tasks:

### Research Tasks (parallel)
- "Find all files related to X"
- "Understand how Y works"
- "Find test files for Z"
- "Check if there are existing implementations of W"

### Implementation Tasks (sequential per file set)
- "Implement feature X in file Y"
- "Add tests for feature X"
- "Update documentation for feature X"

### Verification Tasks (after implementation)
- "Verify feature X works correctly"
- "Run tests and check for regressions"
- "Check edge cases and error handling"

### Guidelines
- Each sub-task should be completable by a single agent
- Research tasks can run in parallel
- Implementation tasks should be serialized per file set
- Verification tasks should run after implementation
- Include specific file paths and line numbers in task descriptions
- State what "done" looks like for each task
`;

// ─── Result Synthesis Guidance ───────────────────────────────────────────────

const RESULT_SYNTHESIS_GUIDANCE = `
## Result Synthesis

When combining results from multiple agents:

### For Research Results
- Identify common themes across findings
- Note contradictions or gaps
- Extract specific file paths and line numbers
- Summarize key insights

### For Implementation Results
- Verify all changes are consistent
- Check for conflicts between changes
- Ensure tests pass
- Document what was changed and why

### For Verification Results
- Aggregate PASS/FAIL verdicts
- Identify patterns in failures
- Prioritize blocking issues
- Suggest fixes for failures

### Output Format
\`\`\`
## Summary
<one paragraph overview>

## Key Findings
- <finding 1>
- <finding 2>

## Changes Made
- <file>: <what changed>

## Issues
- <issue 1>
- <issue 2>

## Next Steps
- <recommendation 1>
- <recommendation 2>
\`\`\`
`;

// ─── Main Extension ──────────────────────────────────────────────────────────

export default function coordinationEnhancements(aery: ExtensionAPI): void {
	// ─── 1. Context summarization guidance ──────────────────────────────────
	aery.on("before_agent_start", (event) => {
		const existingPrompt = event.systemPrompt ?? "";
		if (!existingPrompt.includes("Task Decomposition")) {
			return {
				systemPrompt: existingPrompt + TASK_DECOMPOSITION_GUIDANCE,
			};
		}
		return undefined;
	});

	// ─── 2. Result synthesis guidance ──────────────────────────────────────
	aery.on("before_agent_start", (event) => {
		const existingPrompt = event.systemPrompt ?? "";
		if (!existingPrompt.includes("Result Synthesis")) {
			return {
				systemPrompt: existingPrompt + RESULT_SYNTHESIS_GUIDANCE,
			};
		}
		return undefined;
	});

	// ─── 3. Agent memory — load on session start ──────────────────────────
	aery.on("session_start", () => {
		// Ensure directories exist
		if (!existsSync(MEMORY_DIR)) {
			try { mkdirSync(MEMORY_DIR, { recursive: true }); } catch {}
		}
		if (!existsSync(INSIGHTS_DIR)) {
			try { mkdirSync(INSIGHTS_DIR, { recursive: true }); } catch {}
		}
	});

	// ─── 4. Agent memory — save insights from tool results ────────────────
	aery.on("tool_result", (event) => {
		const toolName = event.toolName.toLowerCase();

		// Save insights from explore/plan/verify agents
		if (toolName === "subagent") {
			const result = event.content;
			if (Array.isArray(result)) {
				for (const part of result) {
					if (part.type === "text" && part.text) {
						// Extract agent name from result
						const agentMatch = part.text.match(/\[Agent: (\w+)\]/);
						if (agentMatch) {
							const agentName = agentMatch[1].toLowerCase();
							const insight = part.text.slice(0, 500);
							saveAgentMemory(agentName, insight);
						}
					}
				}
			}
		}

		return undefined;
	});

	// ─── Register memory tools ─────────────────────────────────────────────
	aery.registerTool({
		name: "agent_memory_read",
		description: "Read an agent's memory from past sessions.",
		parameters: {
			type: "object",
			properties: {
				agent: { type: "string", description: "Agent name (explore, plan, verify, general, coordinator)" },
			},
			required: ["agent"],
		} as any,
		async execute(_id, params) {
			const memory = loadAgentMemory((params as any).agent);
			if (!memory) {
				return {
					content: [{ type: "text" as const, text: `No memory found for agent: ${(params as any).agent}` }],
				};
			}
			return {
				content: [{ type: "text" as const, text: `Agent memory for ${(params as any).agent}:\n\n${memory}` }],
			};
		},
	});

	aery.registerTool({
		name: "agent_memory_write",
		description: "Write an insight to an agent's memory.",
		parameters: {
			type: "object",
			properties: {
				agent: { type: "string", description: "Agent name" },
				insight: { type: "string", description: "Insight to remember" },
			},
			required: ["agent", "insight"],
		} as any,
		async execute(_id, params) {
			saveAgentMemory((params as any).agent, (params as any).insight);
			return {
				content: [{ type: "text" as const, text: `Saved insight to ${(params as any).agent} memory` }],
			};
		},
	});

	// ─── Register context summarization tool ───────────────────────────────
	aery.registerTool({
		name: "context_summary",
		description: "Get a summary of the current conversation context for passing to fork children.",
		parameters: {
			type: "object",
			properties: {},
		} as any,
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const conversation = ctx.getConversation();
			const summary = summarizeConversation(conversation);

			return {
				content: [{
					type: "text" as const,
					text: `Context summary (${conversation.length} messages, ${summary.length} chars):\n\n${summary}`,
				}],
			};
		},
	});
}
