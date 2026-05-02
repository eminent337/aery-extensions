/**
 * Aery Skill Auto-Creation — Background Mode
 * Saves skills directly in the background without interrupting the conversation.
 *
 * Triggers: complex task (5+ turns with failures)
 * Skills are written directly to disk using the session's LLM — no sendUserMessage.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const SKILLS_DIR = join(homedir(), ".aery", "agent", "skills", "auto");

function ensureDir() {
	if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
}

function slugify(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-$/, "");
}

export default function (aery: ExtensionAPI) {
	let taskPrompt = "";
	let turnCount = 0;
	let hadFailure = false;
	let conversationSummary: string[] = [];

	aery.on("before_agent_start", async (event) => {
		taskPrompt = event.prompt?.slice(0, 150) || "";
		turnCount = 0;
		hadFailure = false;
		conversationSummary = [];
	});

	aery.on("turn_end", async () => {
		turnCount++;
	});

	aery.on("tool_result", async (event) => {
		if (event.toolName === "bash") {
			const output = JSON.stringify((event as any).result || "");
			if (output.includes("exit code") || output.includes("Error") || output.includes("failed")) {
				hadFailure = true;
			}
		}
	});

	aery.on("agent_end", async (event, ctx) => {
		if (!taskPrompt || taskPrompt.length < 30) return;
		if (/^(what|who|how|why|when|where|tell me|show me|explain|hi|hello|yes|no|okay|good|thanks|what was|what is|what are)/i.test(taskPrompt)) return;

		const shouldSave = turnCount >= 3 && hadFailure;
		if (!shouldSave) return;

		const messages = event.messages || [];
		const lastAssistant = messages.filter((m: any) => m.role === "assistant").pop();
		const lastText = lastAssistant?.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("") || "";

		if (/error|failed|cannot|unable|sorry/i.test(lastText.slice(-200))) return;

		ensureDir();
		const slug = slugify(taskPrompt.slice(0, 40));
		const filename = `${slug}-${Date.now()}.md`;
		const filePath = join(SKILLS_DIR, filename);

		// Build skill content directly — no LLM call needed for simple cases
		// Extract key info from the conversation
		const assistantTexts = messages
			.filter((m: any) => m.role === "assistant")
			.map((m: any) => m.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") || "")
			.filter((t: string) => t.length > 50)
			.slice(-3) // last 3 assistant messages
			.join("\n\n");

		const skillContent = `# Skill: ${taskPrompt.slice(0, 60)}

## Description
Auto-captured skill from a complex task (${turnCount} turns, fixed after failures).

## Task
${taskPrompt}

## Key Discovery
${assistantTexts.slice(0, 500) || "See task description for context."}

## When to Use
Use when facing similar tasks involving: ${taskPrompt.slice(0, 80)}

## Notes
- Captured automatically after ${turnCount} turns
- Task involved failures that were resolved
`;

		try {
			writeFileSync(filePath, skillContent, "utf-8");
			ctx.ui.notify(`Skill saved in background: ${filename}`, "info");
		} catch (e: any) {
			// Silent fail — don't interrupt user
		}
	});
}
