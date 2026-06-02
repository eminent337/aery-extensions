import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";

// Web Research Agent — orchestrates multi-page research and synthesis
// Inspired by Codebuff's researcher_web and researcher_docs

const ResearchWebParams = Type.Object({
	question: Type.String({
		description: "The research question or topic to investigate."
	}),
	maxSources: Type.Optional(Type.Number({
		description: "Maximum number of sources to consult. Default 5."
	})),
	depth: Type.Optional(Type.String({
		description: "Research depth: 'quick' for a brief answer from snippets, 'deep' for reading full pages and synthesizing. Default 'quick'."
	}))
});

export function registerWebResearcherTool(aery: ExtensionAPI) {
	const researchTool: ToolDefinition<typeof ResearchWebParams, { question: string; maxSources?: number; depth?: string }> = {
		name: "ResearchWeb",
		label: "Web Research",
		description: "Research a topic on the web by searching and reading multiple sources. Returns a synthesized summary with citations. Use this to look up documentation, APIs, best practices, or any web-based information.",
		parameters: ResearchWebParams,
		async execute(_id, params) {
			const maxSources = params.maxSources || 5;
			const isDeep = params.depth === "deep";

			let output = `## Research: "${params.question}"\n\n`;
			output += isDeep ? "🔍 Deep research mode — reading full pages\n\n" : "🔍 Quick research mode — checking search snippets\n\n";

			// The tool returns the research request; the LLM agent uses web_search and web_fetch tools
			// to actually execute the research. This tool serves as the orchestrator.
			output += `**Instructions:**\n`;
			output += `1. Use \`web_search\` to search for: "${params.question}"\n`;
			output += `2. Review the search results and select the ${maxSources} most relevant sources\n`;
			if (isDeep) {
				output += `3. For each relevant source, use \`web_fetch\` or \`WebFetch\` to read the full page content\n`;
				output += `4. Synthesize findings from all sources into a comprehensive answer\n`;
			} else {
				output += `3. Synthesize findings from the search snippets into a concise answer\n`;
			}
			output += `5. Cite sources with URLs\n`;
			output += `6. If you need to dive deeper on a subtopic, use \`web_search\` again with more specific queries\n\n`;

			output += `**Research question:** ${params.question}\n`;

			return {
				content: [{ type: "text", text: output }],
			};
		}
	};

	aery.registerTool(researchTool);
}
