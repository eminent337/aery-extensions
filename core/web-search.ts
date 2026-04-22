/**
 * Aery Web Search Tool (Phase 1.4)
 * Multi-provider search: DuckDuckGo (free default), Tavily, Exa, Brave.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "@sinclair/typebox";

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

async function searchDuckDuckGo(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	// DuckDuckGo HTML search (no API key needed)
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
	const res = await fetch(url, {
		signal,
		headers: { "User-Agent": "Mozilla/5.0 (compatible; Aery/1.0)" },
	});
	const html = await res.text();

	const results: SearchResult[] = [];
	// Parse result blocks from DDG HTML
	const blockRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
	let match;
	while ((match = blockRegex.exec(html)) !== null && results.length < 8) {
		let rawUrl = match[1];
		// Strip DDG tracking params (&rut=...)
		rawUrl = rawUrl.split("&rut=")[0].split("&amp;rut=")[0];
		rawUrl = rawUrl.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "");
		const url = decodeURIComponent(rawUrl);
		const title = match[2].replace(/<[^>]+>/g, "").trim();
		const snippet = match[3].replace(/<[^>]+>/g, "").trim();
		if (title && url.startsWith("http")) {
			results.push({ title, url, snippet });
		}
	}
	return results;
}

async function searchTavily(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		signal,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 8 }),
	});
	const data = await res.json() as any;
	return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
}

async function searchBrave(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
		signal,
		headers: { "Accept": "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY! },
	});
	const data = await res.json() as any;
	return (data.web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
}

async function searchExa(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const res = await fetch("https://api.exa.ai/search", {
		method: "POST",
		signal,
		headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY! },
		body: JSON.stringify({ query, numResults: 8, useAutoprompt: true }),
	});
	const data = await res.json() as any;
	return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.text?.slice(0, 200) ?? "" }));
}

function formatResults(results: SearchResult[], query: string): string {
	if (!results.length) return `No results found for: ${query}`;
	return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		description: "Search the web and return results with titles, URLs, and snippets.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			provider: Type.Optional(Type.String({ description: "Provider: duckduckgo (default), tavily, brave, exa" })),
		}),
		async execute(_id, params, signal, onUpdate) {
			const preferred = params.provider ??
				(process.env.TAVILY_API_KEY ? "tavily" :
				process.env.BRAVE_API_KEY ? "brave" :
				process.env.EXA_API_KEY ? "exa" : "duckduckgo");

			onUpdate?.({ content: [{ type: "text", text: `Searching: ${params.query}` }], details: {} });

			// Fallback chain: try preferred first, then others, then duckduckgo
			const chain: Array<() => Promise<SearchResult[]>> = [];
			if (preferred === "tavily" && process.env.TAVILY_API_KEY) chain.push(() => searchTavily(params.query, signal));
			if (preferred === "brave" && process.env.BRAVE_API_KEY) chain.push(() => searchBrave(params.query, signal));
			if (preferred === "exa" && process.env.EXA_API_KEY) chain.push(() => searchExa(params.query, signal));
			chain.push(() => searchDuckDuckGo(params.query, signal)); // always last

			let lastError: any;
			for (const fn of chain) {
				try {
					const results = await fn();
					if (results.length > 0) {
						return {
							content: [{ type: "text" as const, text: formatResults(results, params.query) }],
							details: { query: params.query, count: results.length },
						};
					}
				} catch (e) {
					lastError = e;
				}
			}

			return { content: [{ type: "text" as const, text: `Search failed: ${lastError?.message ?? "no results"}` }], details: {} };
		},
	});
}
