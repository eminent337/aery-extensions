/**
 * Aery Agent Chain (Phase 3.1)
 * /chain step one | step two | step three
 * Runs sequential prompts, feeding each response into the next.
 * Uses sendUserMessage to chain within the same session (no sub-process needed).
 */

import type { ExtensionAPI } from "@eminent337/aery";

export default function (_aery: ExtensionAPI) {
	// Chain functionality is handled by subagent tool in chain mode
}
