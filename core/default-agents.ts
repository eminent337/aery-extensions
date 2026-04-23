/**
 * Aery default AGENTS.md
 * Creates ~/.aery/AGENTS.md on first run if it doesn't exist.
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const AGENTS_PATH = join(homedir(), ".aery", "AGENTS.md");

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

## Memory
- @include ~/.aery/memory.md
`;

export default function (aery: ExtensionAPI) {
	aery.on("session_start", async () => {
		if (existsSync(AGENTS_PATH)) return;
		const dir = join(homedir(), ".aery");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(AGENTS_PATH, DEFAULT_AGENTS_MD);
	});
}
