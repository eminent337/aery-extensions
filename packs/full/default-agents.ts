import type { ExtensionAPI } from "@aryee337/aery";
import { access, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_AGENTS_MD = `# Aery Global Instructions

## Behavior
- Be concise. Prefer short, direct responses over long explanations.
- Ask before making large changes. Confirm scope before refactoring.
- Prefer editing existing files over creating new ones.
- Never delete files without explicit confirmation.

## Code Style
- Match the existing code style of the project.
- Add comments only when the logic is non-obvious.
- Prefer simple solutions over clever ones.

## Tools
- Use bash for quick checks before writing code.
- Read files before editing them.
- Run tests after making changes when a test command is available.

### Available Tools
- **CodeSearchTool**: Search codebase using ripgrep with multiple regex queries in parallel. Use for finding code patterns, imports, function definitions across the project.
- **StrReplaceTool**: Make targeted/surgical edits to files by replacing exact strings. Safer than rewriting entire files.
- **FilePickerTool**: Find relevant files by describing what you need. Uses fuzzy search on filenames and content.
- **browser_navigate / browser_fill / browser_click / browser_extract / browser_screenshot / browser_evaluate / browser_console / browser_close**: Browser automation suite for testing web UIs, filling forms, capturing screenshots, checking console errors.
- **ContextPruneTool / ContextStatusTool**: Manage long conversations by creating checkpoints with summaries of what's been done and what remains.
- **TodoUpdate / TodoList**: Track progress during multi-step implementations. Use TodoUpdate to create and update an ordered task list with completion status.
- **ReviewCode**: Review code changes for bugs, security issues, error handling, and correctness. Use after making significant changes.
- **ResearchWeb**: Research topics on the web by searching and reading multiple sources. Use for looking up documentation, APIs, and best practices.

## Memory
- @include ~/.aery/memory.md
`;

export default function defaultAgents(aery: ExtensionAPI) {
	aery.on("session_start", async () => {
		const agentsDir = join(homedir(), ".aery");
		const agentsFile = join(agentsDir, "AGENTS.md");

		try {
			await access(agentsFile);
			// File exists, don't overwrite
		} catch {
			// File doesn't exist, create it
			await mkdir(agentsDir, { recursive: true });
			await writeFile(agentsFile, DEFAULT_AGENTS_MD, "utf-8");
		}
	});
}
