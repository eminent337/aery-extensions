/**
 * Aery Memory @include (Phase 2.2)
 * Adds @include directive to AGENTS.md / system prompt.
 *
 * Usage in AGENTS.md:
 *   @include ~/.aery/shared/coding-standards.md
 *   @include ./team-rules.md
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

function resolveIncludes(content: string, basePath: string, visited = new Set<string>()): string {
	return content.replace(/^@include\s+(.+)$/gm, (_match, rawPath) => {
		const expanded = rawPath.trim().replace(/^~/, homedir());
		const resolved = expanded.startsWith("/") ? expanded : resolve(basePath, expanded);
		if (visited.has(resolved)) return `<!-- @include ${rawPath}: circular skipped -->`;
		if (!existsSync(resolved)) return `<!-- @include ${rawPath}: not found -->`;
		visited.add(resolved);
		return resolveIncludes(readFileSync(resolved, "utf-8"), dirname(resolved), visited);
	});
}

export default function (aery: ExtensionAPI) {
	aery.on("before_agent_start", async (event, _ctx) => {
		if (!event.systemPrompt.includes("@include")) return;
		const resolved = resolveIncludes(event.systemPrompt, process.cwd());
		if (resolved !== event.systemPrompt) {
			return { systemPrompt: resolved };
		}
	});
}
