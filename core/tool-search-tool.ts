/**
 * Tool Search Tool — Discover tools by keyword or direct selection.
 * Useful when there are many tools and the agent needs to find the right one.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { registerToolAliases } from "./tool-aliases.js";
import { Type } from "typebox";

export function registerToolSearchTool(aery: ExtensionAPI): void {
	aery.registerTool({
		name: "tool_search_all",
		description:
			'Search for available tools by keyword or select directly. Use "select:<tool_name>" for direct selection, or keywords to search tool descriptions.',
		promptSnippet: "search for available tools",
		promptGuidelines: [
			"Use tool_search to discover tools when you're not sure what's available",
			"Use 'select:<tool_name>' to directly activate a specific tool",
			"Use keywords to search tool names and descriptions",
		],
		parameters: Type.Object({
			query: Type.String({
				description:
					'Search query. Use "select:<tool_name>" for direct selection, or keywords to search.',
			}),
			max_results: Type.Optional(
				Type.Number({
					description: "Maximum results to return (default: 5)",
				}),
			),
		}),
		async execute(_id, params) {
			const allTools = aery.getAllTools();
			const query = params.query.trim();
			const maxResults = params.max_results ?? 5;

			// Direct selection mode
			if (query.startsWith("select:")) {
				const toolName = query.slice("select:".length).trim();
				const tool = allTools.find(
					(t) =>
						t.name.toLowerCase() === toolName.toLowerCase(),
				);

				if (tool) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Found tool: ${tool.name}\n${tool.description}`,
							},
						],
						details: {
							matches: [tool.name],
							query,
						},
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `No tool found with name: ${toolName}`,
						},
					],
					details: { matches: [], query },
				};
			}

			// Keyword search mode
			const queryLower = query.toLowerCase();
			const keywords = queryLower
				.split(/\s+/)
				.filter((k) => k.length > 0);

			const scored = allTools
				.map((tool) => {
					const nameLower = tool.name.toLowerCase();
					const descLower = tool.description.toLowerCase();

					let score = 0;

					// Exact name match
					if (nameLower === queryLower) score += 100;

					// Name contains query
					if (nameLower.includes(queryLower)) score += 50;

					// Keyword matching
					for (const keyword of keywords) {
						if (nameLower.includes(keyword)) score += 20;
						if (descLower.includes(keyword)) score += 10;
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
							text: `No tools found matching: "${query}". Try broader keywords.`,
						},
					],
					details: { matches: [], query },
				};
			}

			const matches = scored.map((s) => s.tool.name);
			const lines = scored.map(
				(s) =>
					`- ${s.tool.name}: ${s.tool.description.slice(0, 120)}`,
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `Found ${scored.length} tools:\n${lines.join("\n")}`,
					},
				],
				details: { matches, query },
			};
		},
	});
	registerToolAliases(aery, { tool_search_all: "ToolSearch" });
}
