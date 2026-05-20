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
	// Inject collaboration context once — skip if already in the system prompt
	pi.on("before_agent_start", (_event, _ctx) => {
		if (_event.systemPrompt.includes("Aery Specialist Collaboration")) return;
		return { systemPrompt: `${_event.systemPrompt}\n\n${SPECIALIST_CONTEXT}` };
	});

}
