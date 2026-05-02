/**
 * Aery Specialist Collaboration
 *
 * Wires the aery specialist agents to collaborate via handoffs.
 * Each agent knows the others' scope and passes context forward.
 *
 * Collaboration pattern:
 *   scout (aery-core) → specialist (aery-ai/tui/agent/mom/pods) → review (aery-review)
 *
 * The session_start hook injects collaboration context so agents
 * naturally hand off to each other without explicit commands.
 */

import type { ExtensionAPI } from "@eminent337/aery";

const SPECIALIST_CONTEXT = `
## Aery Specialist Collaboration

You are working on the Aery monorepo. When a task clearly belongs to a specific package, say so and suggest the right specialist. When you complete work, summarize what you did so the next agent can pick up cleanly.

Package ownership:
- packages/ai → aery-ai (LLM providers, streaming, model registry)
- packages/agent → aery-agent (core loop, tool execution, context management)
- packages/tui + packages/web-ui → aery-tui (terminal UI, keybindings, Ink, Lit)
- packages/mom → aery-mom (Slack bot, multi-agent orchestration)
- packages/pods → aery-pods (GPU pods, vLLM, model serving)
- root config, scripts/, .github/, cross-package → aery-core

Handoff rules:
- After implementing anything: run \`npm run check\`, fix all errors, then summarize changes for review
- After reviewing: list blocking issues first, then non-blocking, then nits
- Never commit unless the user explicitly asks
- No \`any\` types, no inline imports, no hardcoded keybindings

When you finish your part, end with:
"Handoff summary: [what was done, what files changed, what to check next]"
`.trim();

export default function (pi: ExtensionAPI) {
	// Inject collaboration context into every agent start
	pi.on("before_agent_start", (_event, _ctx) => {
		const base = _event.systemPrompt;
		return { systemPrompt: `${base}\n\n${SPECIALIST_CONTEXT}` };
	});

	// /aery-collab — shows who does what and how handoffs work
	pi.registerCommand("aery-collab", {
		description: "Show aery specialist collaboration map — who owns what and how agents hand off to each other",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`**Aery Specialist Collaboration**

**Package ownership:**
- \`aery-ai\`    → packages/ai (providers, streaming, models)
- \`aery-agent\` → packages/agent (core loop, tools, context)
- \`aery-tui\`   → packages/tui + web-ui (UI, keybindings)
- \`aery-mom\`   → packages/mom (Slack bot, orchestration)
- \`aery-pods\`  → packages/pods (GPU, vLLM, serving)
- \`aery-core\`  → root, scripts, git, cross-package
- \`aery-review\`→ final quality gate (read-only)

**Collaboration chains:**
\`/chain scout the relevant code for X | implement X in the right package | review the changes\`
\`/chain add provider Y to packages/ai | update coding-agent to expose it | review\`
\`/chain find the keybinding bug in tui | fix it | verify npm run check passes\`

Each step receives the previous step's output. End each step with a handoff summary.`, "info");
		},
	});
}
