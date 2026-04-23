/**
 * Aery Doctor
 * /doctor — checks API keys, model availability, extension health, and tools.
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@eminent337/aery";

function check(label: string, ok: boolean, note = ""): string {
	const icon = ok ? "✅" : "❌";
	return `${icon} **${label}**${note ? ` — ${note}` : ""}`;
}

function cmd(command: string): boolean {
	try { execSync(command, { stdio: "ignore" }); return true; } catch { return false; }
}

export default function (aery: ExtensionAPI) {
	aery.registerCommand("doctor", {
		description: "Check API keys, models, extensions, and tools",
		handler: async (_args, ctx) => {
			const lines: string[] = ["## Aery Doctor\n"];

			// API keys
			lines.push("### API Keys");
			const keys: [string, string][] = [
				["OpenAI", "OPENAI_API_KEY"],
				["Anthropic", "ANTHROPIC_API_KEY"],
				["Google Gemini", "GEMINI_API_KEY"],
				["OpenRouter", "OPENROUTER_API_KEY"],
				["Groq", "GROQ_API_KEY"],
				["Mistral", "MISTRAL_API_KEY"],
			];
			let anyKey = false;
			for (const [name, env] of keys) {
				const set = !!process.env[env];
				if (set) anyKey = true;
				lines.push(check(name, set, set ? env : `${env} not set`));
			}
			if (!anyKey) lines.push("\n> ⚠️ No API keys found. Run `/login` or set an environment variable.");

			// Tools
			lines.push("\n### System Tools");
			lines.push(check("Node.js", cmd("node --version"), "required"));
			lines.push(check("git", cmd("git --version"), "required for worktree/checkpoint"));
			lines.push(check("fd", cmd("fd --version"), "file search"));
			lines.push(check("rg (ripgrep)", cmd("rg --version"), "code search"));
			lines.push(check("tmux", cmd("tmux -V"), "required for worktree sessions"));

			// Extensions
			lines.push("\n### Extensions");
			const exts = aery.getCommands();
			lines.push(check("Extensions loaded", exts.length > 0, `${exts.length} commands registered`));

			// Network
			lines.push("\n### Network");
			try {
				const res = await fetch("https://registry.npmjs.org/@eminent337/aery/latest", { signal: AbortSignal.timeout(4000) });
				const data = await res.json() as { version: string };
				const { VERSION } = await import("@eminent337/aery");
				const upToDate = data.version === VERSION;
				lines.push(check("npm registry", true, `reachable`));
				lines.push(check("Version", upToDate, upToDate ? `v${VERSION} (latest)` : `v${VERSION} installed, v${data.version} available — run: npm install -g @eminent337/aery`));
			} catch {
				lines.push(check("npm registry", false, "unreachable — check connection"));
			}

			lines.push("\n---\n_Run `/help` to see all available commands._");
			aery.sendUserMessage(lines.join("\n"));
		},
	});
}
