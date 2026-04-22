/**
 * Aery Cross-Agent Compatibility (Phase 1.8)
 * Loads skills/commands from .claude/, .gemini/, .codex/ directories.
 * Existing Claude Code skills work in aery without changes.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";

const SCAN_DIRS = [
	".claude/commands",
	".gemini/commands",
	".codex/commands",
	".claude/skills",
	".gemini/skills",
];

// Global dirs (always scanned regardless of cwd)
import { homedir } from "node:os";
const GLOBAL_SCAN_DIRS = [
	join(homedir(), ".claude", "commands"),
	join(homedir(), ".claude", "skills"),
	join(homedir(), ".gemini", "commands"),
	join(homedir(), ".codex", "commands"),
];

function parseFrontmatter(content: string): { name?: string; description?: string; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { body: content };
	const meta: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const kv = line.match(/^(\w+):\s*(.+)$/);
		if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
	}
	return { name: meta.name, description: meta.description, body: match[2].trim() };
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const cwd = process.cwd();
		let loaded = 0;

		for (const dir of SCAN_DIRS) {
			const fullDir = join(cwd, dir);
			if (!existsSync(fullDir)) continue;

			let files: string[];
			try { files = readdirSync(fullDir).filter(f => f.endsWith(".md")); }
			catch { continue; }

			for (const file of files) {
				try {
					const content = readFileSync(join(fullDir, file), "utf-8");
					const { name, description, body } = parseFrontmatter(content);
					const cmdName = name ?? basename(file, ".md");
					const cmdDesc = description ?? `Skill from ${dir}/${file}`;

					// Register as a slash command that sends the skill prompt
					pi.registerCommand(cmdName, {
						description: `[${dir}] ${cmdDesc}`,
						handler: async (args, cmdCtx) => {
							const prompt = args ? body.replace(/\$@/g, args).replace(/\$1/g, args) : body;
							await cmdCtx.sendMessage(prompt);
						},
					});
					loaded++;
				} catch {}
			}
		}

		if (loaded > 0) {
			ctx.ui.notify(`Loaded ${loaded} cross-agent skill${loaded > 1 ? "s" : ""} from .claude/.gemini/.codex`, "info");
		}
	});
}
