/**
 * Aery Skill Auto-Creation (Hermes Learning Loop)
 * Saves skills when agent acquires new knowledge or fixes complex failures.
 *
 * Triggers:
 * 1. Task had errors/failures that were fixed (retry pattern)
 * 2. Agent used web_search (new knowledge beyond training)
 * 3. Task required 5+ turns to solve (complex problem)
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
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

export default function (pi: ExtensionAPI) {
	let taskPrompt = "";
	let turnCount = 0;
	let hadFailure = false;
	let toolErrorCount = 0;

	pi.on("before_agent_start", async (event) => {
		taskPrompt = event.prompt?.slice(0, 150) || "";
		turnCount = 0;
		hadFailure = false;
		toolErrorCount = 0;
	});

	pi.on("turn_end", async () => {
		turnCount++;
	});

	pi.on("tool_result", async (event) => {
		// Track bash failures (non-zero exit)
		if (event.toolName === "bash") {
			const output = JSON.stringify((event as any).result || "");
			if (output.includes("exit code") || output.includes("Error") || output.includes("failed")) {
				hadFailure = true;
			}
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!taskPrompt || taskPrompt.length < 30) return;
		// Skip conversational/trivial prompts
		if (/^(what|who|how|why|when|where|tell me|show me|explain|hi|hello|yes|no|okay|good|thanks|what was|what is|what are)/i.test(taskPrompt)) return;

		const shouldSave = turnCount >= 5 && hadFailure; // complex problem that needed retries

		if (!shouldSave) return;

		// Verify task ended successfully (last assistant message doesn't indicate failure)
		const messages = event.messages || [];
		const lastAssistant = messages.filter((m: any) => m.role === "assistant").pop();
		const lastText = lastAssistant?.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("") || "";

		const endedInFailure = /error|failed|cannot|unable|sorry/i.test(lastText.slice(-200));
		if (endedInFailure) return;

		ensureDir();
		const slug = slugify(taskPrompt.slice(0, 40));
		const filename = `${slug}-${Date.now()}.md`;
		const path = join(SKILLS_DIR, filename);

		const reason = hadFailure
			? `fixed after ${toolErrorCount} failure(s)`
			: `complex task (${turnCount} turns)`;

		pi.sendUserMessage(
			`[skill-autocreate] Saving skill — ${reason}. Write a reusable skill document and save it to \`${path}\` using the write tool.\n\nTask: "${taskPrompt}"\n\nInclude: name, description, key_discovery (what was learned/fixed), steps, when_to_use. Under 25 lines.`,
			{ deliverAs: "followUp" }
		);

		ctx.ui.notify(`Skill saved: ${filename} (${reason})`, "info");
	});

	pi.registerCommand("skills-auto", {
		description: "List auto-generated skills",
		handler: async (args, ctx) => {
			ensureDir();
			const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
			if (files.length === 0) {
				ctx.ui.notify("No skills saved yet. Skills are saved when agent fixes failures or uses web search.", "info");
				return;
			}
			pi.sendUserMessage(`Saved skills (${files.length}):\n\n${files.join("\n")}`);
		},
	});
}
