/**
 * Aery Skill Improvement Watcher (Phase 2.3)
 * Every 5 turns, if skills were used, suggests improvements.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";
import { readFileSync, writeFileSync } from "node:fs";

const SKILLS_DIR = join(homedir(), ".aery", "agent", "skills");
const IMPROVE_EVERY = 5;
const SCORES_PATH = join(homedir(), ".aery", "agent", "skill-scores.json");

function loadScores(): Record<string, { success: number; fail: number }> {
	if (!existsSync(SCORES_PATH)) return {};
	try { return JSON.parse(readFileSync(SCORES_PATH, "utf-8")); }
	catch { return {}; }
}

function saveScores(scores: Record<string, { success: number; fail: number }>) {
	writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2));
}

export default function (aery: ExtensionAPI) {
	let turnCount = 0;
	let skillsUsedThisCycle = false;

	if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });

	aery.on("turn_end", async (event) => {
		turnCount++;

		const usedSkill = event.toolResults?.some((r: any) => {
			const input = JSON.stringify(r.input ?? "");
			return input.includes("skill") || input.includes(".aery/agent/skills");
		}) ?? false;

		if (usedSkill) {
			skillsUsedThisCycle = true;
			const hasError = event.toolResults?.some((r: any) => r.isError) ?? false;
			const scores = loadScores();
			if (!scores["session-skill"]) scores["session-skill"] = { success: 0, fail: 0 };
			if (hasError) scores["session-skill"].fail++;
			else scores["session-skill"].success++;
			saveScores(scores);
		}

		if (turnCount % IMPROVE_EVERY === 0 && skillsUsedThisCycle) {
			skillsUsedThisCycle = false;
			aery.sendUserMessage(
				"[skill-watcher] You've used skills in the last 5 turns. Suggest any improvements to their instructions or scope. Be concise.",
				{ deliverAs: "followUp" },
			);
		}
	});
}
