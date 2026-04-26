/**
 * Graphify extension for Aery
 * /graphify — triggers the agent to build a knowledge graph using the graphify skill
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@eminent337/aery";

function findGraphify(): string | null {
	const home = process.env.HOME || "";
	for (const p of [`${home}/.local/bin/graphify`, "/usr/local/bin/graphify", "/usr/bin/graphify"]) {
		if (existsSync(p)) return p;
	}
	return null;
}

async function ensureSkill(bin: string, exec: any): Promise<void> {
	const skillPath = `${process.env.HOME}/.kiro/skills/graphify/SKILL.md`;
	if (!existsSync(skillPath)) {
		await exec(bin, ["install", "--platform", "kiro"], { timeout: 30_000 }).catch(() => {});
	}
}

export default function (aery: ExtensionAPI) {
	aery.on("session_start", async (_event, _ctx) => {
		const bin = findGraphify();
		if (!bin) return;
		await ensureSkill(bin, aery.exec.bind(aery));
	});

	aery.registerCommand("graphify", {
		description: "Build a knowledge graph of the current project",
		handler: async (args, ctx) => {
			const bin = findGraphify();
			if (!bin) {
				ctx.ui.notify("graphify not installed. Run: pipx install graphifyy", "warning");
				return;
			}
			await ensureSkill(bin, aery.exec.bind(aery));
			const path = args.trim() || ".";
			const flags = [];
			if (args.includes("--deep")) flags.push("--mode deep");
			if (args.includes("--update")) flags.push("--update");
			if (args.includes("--no-viz")) flags.push("--no-viz");
			const flagStr = flags.length ? ` ${flags.join(" ")}` : "";
			aery.sendUserMessage(`/graphify ${path}${flagStr}`);
		},
	});
}
