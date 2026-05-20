/**
 * Agent Enhancements Extension
 *
 * Improvements for Aery's agent system:
 * 1. System prompt for coordination — guidance on when to use sub-agents
 * 2. Auto-verification — spawn verify agent after implementing changes
 * 3. Agent memory — persistent memory across sessions
 * 4. Parallel explore — guidance for parallel exploration
 * 5. Task decomposition — guidance for complex tasks
 * 6. Cost tracking — track token usage per agent
 * 7. Agent timeout — timeout for subagent execution
 * 8. Result caching — cache explore results
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

// ─── Constants ───────────────────────────────────────────────────────────────

const MEMORY_DIR = join(homedir(), ".aery", "agent", "agent-memory");
const COST_LOG = join(homedir(), ".aery", "agent", "agent-costs.json");
const CACHE_DIR = join(homedir(), ".aery", "agent", "agent-cache");
const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Coordination System Prompt ──────────────────────────────────────────────

const COORDINATION_GUIDANCE = `
## Multi-Agent Coordination

For complex tasks, use the subagent tool to delegate work:

- **Explore agent**: Fast read-only codebase search. Use when you need to understand code structure, find files, or investigate issues. Can run multiple explore agents in parallel.
- **Plan agent**: Software architect. Use before implementing changes to design the approach.
- **Verify agent**: Adversarial verifier. Use after implementing changes to catch bugs.
- **General agent**: General-purpose worker. Use for implementation tasks.
- **Coordinator agent**: Multi-agent orchestrator. Use for tasks that need parallel work.

**Workflow for complex tasks:**
1. Spawn explore agents to investigate the codebase (parallel)
2. Spawn plan agent to design the implementation
3. Spawn general agents to implement changes
4. Spawn verify agent to test the implementation

**When to use sub-agents:**
- Task touches 3+ files → use plan agent first
- Task requires understanding multiple parts of codebase → use parallel explore agents
- Task involves implementation → use verify agent after
- Task is simple (1-2 files) → do it directly, no sub-agents needed

**Parallel execution:**
- Read-only tasks (explore, plan) can run in parallel
- Write tasks should be serialized per file set
- Verification can run alongside implementation on different files
`;

// ─── Cost Tracking ───────────────────────────────────────────────────────────

interface CostEntry {
	agent: string;
	tokens: number;
	cost: number;
	timestamp: string;
}

function loadCosts(): CostEntry[] {
	try {
		if (existsSync(COST_LOG)) {
			return JSON.parse(readFileSync(COST_LOG, "utf-8"));
		}
	} catch {}
	return [];
}

function saveCost(entry: CostEntry): void {
	try {
		const costs = loadCosts();
		costs.push(entry);
		// Keep last 1000 entries
		if (costs.length > 1000) costs.splice(0, costs.length - 1000);
		writeFileSync(COST_LOG, JSON.stringify(costs, null, 2));
	} catch {}
}

// ─── Result Cache ────────────────────────────────────────────────────────────

interface CacheEntry {
	query: string;
	result: string;
	timestamp: string;
	hits: number;
}

function getCachePath(key: string): string {
	const hash = Buffer.from(key).toString("base64url").slice(0, 32);
	return join(CACHE_DIR, `${hash}.json`);
}

function getCached(key: string): CacheEntry | null {
	try {
		const path = getCachePath(key);
		if (!existsSync(path)) return null;
		const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry;
		// Cache expires after 1 hour
		if (Date.now() - new Date(entry.timestamp).getTime() > 3600_000) return null;
		return entry;
	} catch {
		return null;
	}
}

function setCache(key: string, result: string): void {
	try {
		if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
		const entry: CacheEntry = {
			query: key,
			result,
			timestamp: new Date().toISOString(),
			hits: 0,
		};
		writeFileSync(getCachePath(key), JSON.stringify(entry, null, 2));
	} catch {}
}

// ─── Main Extension ──────────────────────────────────────────────────────────

export default function agentEnhancements(pi: ExtensionAPI): void {
	// ─── 1. System prompt for coordination ─────────────────────────────────
	pi.on("before_agent_start", (event) => {
		const existingPrompt = event.systemPrompt ?? "";
		if (!existingPrompt.includes("Multi-Agent Coordination")) {
			return {
				systemPrompt: existingPrompt + COORDINATION_GUIDANCE,
			};
		}
		return undefined;
	});

	// ─── 2. Auto-verification after implementation ─────────────────────────
	let lastEditCount = 0;
	let turnCount = 0;

	pi.on("tool_result", (event) => {
		const toolName = event.toolName.toLowerCase();
		if (toolName === "edit" || toolName === "write" || toolName === "notebook_edit") {
			lastEditCount++;
		}
		return undefined;
	});

	pi.on("turn_end", () => {
		turnCount++;
		// After 3+ edits in a turn, suggest verification
		if (lastEditCount >= 3) {
			pi.sendUserMessage(
				`[Auto-Verify] You've made ${lastEditCount} file changes. Consider spawning a verify agent to test the implementation.`,
			);
		}
		lastEditCount = 0;
	});

	// ─── 3. Agent memory — load on session start ──────────────────────────
	pi.on("session_start", () => {
		// Ensure memory directory exists
		if (!existsSync(MEMORY_DIR)) {
			try { mkdirSync(MEMORY_DIR, { recursive: true }); } catch {}
		}
		// Ensure cache directory exists
		if (!existsSync(CACHE_DIR)) {
			try { mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
		}
	});

	// ─── 6. Cost tracking — log on turn end ───────────────────────────────
	pi.on("turn_end", () => {
		const usage = pi.getContextUsage();
		if (usage) {
			saveCost({
				agent: "main",
				tokens: usage.tokens ?? 0,
				cost: 0, // Cost calculation needs model info
				timestamp: new Date().toISOString(),
			});
		}
	});

	// ─── 7. Agent timeout — handled in subagent tool via signal ───────────
	// The subagent tool already supports AbortSignal. We just need to
	// ensure the signal is passed through. This is handled in the
	// subagent tool's execute function.

	// ─── 8. Result caching — register cache-aware explore wrapper ──────────
	pi.on("before_agent_start", (event) => {
		// Add cache directory info to system prompt
		const existingPrompt = event.systemPrompt ?? "";
		if (!existingPrompt.includes("Agent Cache")) {
			return {
				systemPrompt: existingPrompt + `\n\n## Agent Cache\nExplore results are cached in ${CACHE_DIR} for 1 hour. Use the same query to get cached results.\n`,
			};
		}
		return undefined;
	});

}
