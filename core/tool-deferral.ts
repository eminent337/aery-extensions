/**
 * Tool Deferral Extension
 *
 * Defers rarely-used tools to save context tokens.
 * Model discovers deferred tools via tool_search.
 *
 * Config: ~/.aery/agent/tool-deferral.json
 *
 * {
 *   "deferred": ["notebook_edit", "mcp_list", "cron_create", ...],
 *   "alwaysLoad": ["bash", "read", "edit", "write", "grep", "find", "ls"]
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

interface DeferralConfig {
	deferred: string[];
	alwaysLoad: string[];
}

function loadConfig(): DeferralConfig {
	const path = join(homedir(), ".aery", "agent", "tool-deferral.json");
	if (!existsSync(path)) {
		return {
			deferred: [
				"notebook_edit",
				"mcp_list",
				"mcp_list_resources",
				"mcp_read_resource",
				"cron_create",
				"cron_delete",
				"cron_list",
				"monitor",
				"lsp",
			],
			alwaysLoad: [
				"bash",
				"read",
				"edit",
				"write",
				"grep",
				"find",
				"ls",
				"web_search",
				"web_fetch",
				"ask_user_question",
				"task_create",
				"task_list",
				"task_update",
				"skill",
			],
		};
	}
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return { deferred: [], alwaysLoad: [] };
	}
}

export default function toolDeferral(aery: ExtensionAPI): void {
	const config = loadConfig();
	const deferredSet = new Set(config.deferred.map((n) => n.toLowerCase()));
	const deferredTools = new Map<string, { name: string; description: string }>();

	// On session start, deactivate deferred tools
	aery.on("session_start", () => {
		const allTools = aery.getAllTools();
		const activeNames: string[] = [];

		for (const tool of allTools) {
			if (deferredSet.has(tool.name.toLowerCase())) {
				// Don't add to active list — deferred
				deferredTools.set(tool.name.toLowerCase(), {
					name: tool.name,
					description: tool.description,
				});
			} else {
				activeNames.push(tool.name);
			}
		}

		// Only set active tools if we actually deferred something
		if (deferredTools.size > 0) {
			aery.setActiveTools(activeNames);
		}
	});

	// Register tool_search for discovering deferred tools
	aery.registerTool({
		name: "tool_search",
		description:
			'Search for deferred tools by keyword. Use "select:<tool_name>" to activate a specific tool, or keywords to search descriptions.',
		promptSnippet: "discover and activate deferred tools",
		promptGuidelines: [
			"Use tool_search to find tools that aren't currently active",
			"Use 'select:<tool_name>' to directly activate a specific tool",
			"Use keywords to search tool names and descriptions",
		],
		parameters: Type.Object({
			query: Type.String({
				description:
					'Search query. Use "select:<tool_name>" for direct activation, or keywords.',
			}),
			max_results: Type.Optional(
				Type.Number({
					description: "Maximum results (default: 5)",
				}),
			),
		}),
		async execute(_id, params) {
			const query = params.query.trim();
			const maxResults = params.max_results ?? 5;

			// Direct activation mode
			if (query.startsWith("select:")) {
				const toolName = query.slice("select:".length).trim().toLowerCase();
				const tool = deferredTools.get(toolName);

				if (tool) {
					// Activate the tool
					const currentActive = aery.getActiveTools();
					aery.setActiveTools([...currentActive, tool.name]);
					deferredTools.delete(toolName);

					return {
						content: [
							{
								type: "text" as const,
								text: `Activated tool: ${tool.name}\n${tool.description}`,
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `No deferred tool found: ${toolName}`,
						},
					],
				};
			}

			// Keyword search mode
			const queryLower = query.toLowerCase();
			const keywords = queryLower.split(/\s+/).filter((k) => k.length > 0);

			const scored = [...deferredTools.values()]
				.map((tool) => {
					const nameLower = tool.name.toLowerCase();
					const descLower = tool.description.toLowerCase();
					let score = 0;

					if (nameLower === queryLower) score += 100;
					if (nameLower.includes(queryLower)) score += 50;
					for (const kw of keywords) {
						if (nameLower.includes(kw)) score += 20;
						if (descLower.includes(kw)) score += 10;
					}

					return { tool, score };
				})
				.filter((item) => item.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, maxResults);

			if (scored.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No deferred tools matching: "${query}"`,
						},
					],
				};
			}

			const lines = scored.map(
				(s) => `- ${s.tool.name}: ${s.tool.description.slice(0, 120)}`,
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `Found ${scored.length} deferred tools:\n${lines.join("\n")}\n\nUse 'select:<tool_name>' to activate.`,
					},
				],
			};
		},
	});
}
