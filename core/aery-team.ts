/**
 * Aery Specialist Team
 *
 * Pre-wires the aery specialist agents into the team system.
 * Registers /aery-team command to spin up a coordinated team for working
 * on the Aery monorepo.
 *
 * Agents:
 *   aery-core   — cross-package, git, root config
 *   aery-ai     — packages/ai, LLM providers
 *   aery-agent  — packages/agent, core loop
 *   aery-tui    — packages/tui + web-ui
 *   aery-mom    — packages/mom, Slack bot
 *   aery-pods   — packages/pods, GPU management
 *   aery-review — read-only code review
 */

import type { ExtensionAPI } from "@eminent337/aery";

const AGENTS = {
	"aery-core": {
		scope: "Cross-package work, git ops, issues, PRs, root config (package.json, tsconfig, biome, scripts/, .github/)",
		tools: "read, grep, find, ls, bash",
	},
	"aery-ai": {
		scope: "packages/ai — LLM providers, streaming, model registry, env-api-keys",
		tools: "read, grep, find, ls, bash",
	},
	"aery-agent": {
		scope: "packages/agent — core agent loop, tool execution, context management, abort signals",
		tools: "read, grep, find, ls, bash",
	},
	"aery-tui": {
		scope: "packages/tui + packages/web-ui — terminal UI, keybindings, Ink components, Lit web components",
		tools: "read, grep, find, ls, bash",
	},
	"aery-mom": {
		scope: "packages/mom — Slack bot, multi-agent orchestration, Docker sandbox, skills system",
		tools: "read, grep, find, ls, bash",
	},
	"aery-pods": {
		scope: "packages/pods — GPU pod management, vLLM deployment, model serving",
		tools: "read, grep, find, ls, bash",
	},
	"aery-review": {
		scope: "Read-only code review — checks for any types, inline imports, hardcoded keybindings, missing tests, CHANGELOG entries",
		tools: "read, grep, find, ls, bash",
	},
} as const;

const RULES = `
Critical rules for all aery agents:
- Run \`npm run check\` after every code change. Fix ALL errors/warnings/infos.
- Never run npm run dev, npm run build, or npm test.
- No \`any\` types. No inline imports. No hardcoded keybindings.
- Never \`git add -A\` — stage only specific files you changed.
- Never commit unless explicitly asked.
- No emojis in commits, issues, or code.
`.trim();

export default function (pi: ExtensionAPI) {
	// Register /aery-team command
	pi.registerCommand("aery-team", {
		description: "Show the aery specialist team — who does what and how to coordinate them",
		handler: async (_args, ctx) => {
			const lines = [
				"**Aery Specialist Team**\n",
				"Use `TeamCreate` to spin up a coordinated team, or delegate directly:\n",
			];

			for (const [name, info] of Object.entries(AGENTS)) {
				lines.push(`**${name}**`);
				lines.push(`  Scope: ${info.scope}`);
				lines.push(`  Tools: ${info.tools}\n`);
			}

			lines.push("**Coordination patterns:**");
			lines.push("  Single agent: ask aery-ai to add a provider");
			lines.push("  Chain: /chain scout the auth code | aery-ai refactor it | aery-review check it");
			lines.push("  Team: TeamCreate with tasks assigned to specific agents");
			lines.push("\n" + RULES);

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// Inject team context into session start so the AI knows the team exists
	pi.on("session_start", async (_event, ctx) => {
		const agentList = Object.entries(AGENTS)
			.map(([name, info]) => `- **${name}**: ${info.scope}`)
			.join("\n");

		ctx.appendSystemPrompt(`
## Aery Specialist Team

When working on the Aery monorepo, you have access to specialist agents via TeamCreate, TaskClaim, TaskComplete, TeamMessage, and TeamInbox tools, or via /chain for sequential work.

Available specialists:
${agentList}

${RULES}

Route tasks to the right specialist. Use aery-review as the final step for any code changes.
`);
	});
}
