/**
 * Prompt to generate AGENTS.md on first use in a project that doesn't have one.
 * Only fires once per project directory.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";

function getSeenPath(cwd: string): string {
	const aeryDir = join(cwd, ".aery");
	return join(aeryDir, ".init-prompted");
}

export default function (aery: ExtensionAPI) {
	aery.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		const cwd = ctx.cwd;
		const agentsMd = join(cwd, "AGENTS.md");
		const seenPath = getSeenPath(cwd);

		// Skip if AGENTS.md exists or we already prompted
		if (existsSync(agentsMd) || existsSync(seenPath)) return;

		// Only prompt in directories that look like a project
		const hasProject = existsSync(join(cwd, "package.json")) ||
			existsSync(join(cwd, "Cargo.toml")) ||
			existsSync(join(cwd, "go.mod")) ||
			existsSync(join(cwd, "pyproject.toml")) ||
			existsSync(join(cwd, ".git"));

		if (!hasProject) return;

		const ok = await ctx.ui.confirm(
			"No AGENTS.md found",
			"Generate an AGENTS.md for this project? It helps aery understand your codebase conventions."
		);

		// Mark as seen regardless of answer
		try {
			mkdirSync(join(cwd, ".aery"), { recursive: true });
			writeFileSync(seenPath, "");
		} catch {}

		if (ok) {
			aery.sendUserMessage(
				"Analyze this codebase and create AGENTS.md in the project root.\n\n" +
				"Include:\n1. How to build, test, and run the project\n2. High-level architecture\n3. Key conventions and rules\n\n" +
				"Be concise. Read existing README.md and config files first. Do not add fluff."
			);
		}
	});
}
