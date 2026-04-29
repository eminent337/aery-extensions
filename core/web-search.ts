/**
 * Aery Web Search Tool
 * Providers: firecrawl, tavily, exa, jina, brave, duckduckgo (auto fallback chain)
 * Control via WEB_SEARCH_PROVIDER env var (auto|firecrawl|tavily|exa|jina|brave|ddg)
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Text } from "@eminent337/aery-tui";
import { Type } from "typebox";

interface SearchResult { title: string; url: string; snippet: string; }

async function searchFirecrawl(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const res = await fetch("https://api.firecrawl.dev/v1/search", {
		method: "POST", signal,
		headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FIRECRAWL_API_KEY}` },
		body: JSON.stringify({ query, limit: 8 }),
	});
	if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
	const data = await res.json() as any;
	return (data.data ?? []).map((r: any) => ({ title: r.title ?? r.url, url: r.url, snippet: r.description ?? "" }));
}

async function searchTavily(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST", signal,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 8 }),
	});
	if (!res.ok) throw new Error(`Tavily ${res.status}`);
	const data = await res.json() as any;
	return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
}

async function searchExa(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const res = await fetch("https://api.exa.ai/search", {
		method: "POST", signal,
		headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY! },
		body: JSON.stringify({ query, numResults: 8, useAutoprompt: true }),
	});
	if (!res.ok) throw new Error(`Exa ${res.status}`);
	const data = await res.json() as any;
	return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.text?.slice(0, 200) ?? "" }));
}

async function searchJina(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const url = `https://s.jina.ai/?q=${encodeURIComponent(query)}&count=8`;
	const res = await fetch(url, {
		signal,
		headers: { "Authorization": `Bearer ${process.env.JINA_API_KEY}`, "Accept": "application/json" },
	});
	if (!res.ok) throw new Error(`Jina ${res.status}`);
	const data = await res.json() as any;
	return (data.data ?? data.results ?? []).map((r: any) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? r.snippet ?? "" }));
}

async function searchBrave(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
		signal,
		headers: { "Accept": "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY! },
	});
	if (!res.ok) throw new Error(`Brave ${res.status}`);
	const data = await res.json() as any;
	return (data.web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
}

async function searchDuckDuckGo(query: string, signal: AbortSignal): Promise<SearchResult[]> {
	// Use duck-duck-scrape package (more reliable than raw HTML scraping)
	try {
		const { search, SafeSearchType } = await import("duck-duck-scrape" as any);
		const response = await search(query, { safeSearch: SafeSearchType.STRICT });
		return (response.results ?? []).slice(0, 8).map((r: any) => ({
			title: r.title || r.url,
			url: r.url,
			snippet: r.description ?? "",
		}));
	} catch {
		// Fallback to HTML scraping if package not available
		const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
			signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; Aery/1.0)" },
		});
		const html = await res.text();
		const results: SearchResult[] = [];
		const rx = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
		let m;
		while ((m = rx.exec(html)) !== null && results.length < 8) {
			let rawUrl = m[1].split("&rut=")[0].split("&amp;rut=")[0].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "");
			const url = decodeURIComponent(rawUrl);
			const title = m[2].replace(/<[^>]+>/g, "").trim();
			const snippet = m[3].replace(/<[^>]+>/g, "").trim();
			if (title && url.startsWith("http")) results.push({ title, url, snippet });
		}
		return results;
	}
}

type Provider = { name: string; key: string | undefined; fn: (q: string, s: AbortSignal) => Promise<SearchResult[]> };

const PROVIDERS: Provider[] = [
	{ name: "firecrawl", key: process.env.FIRECRAWL_API_KEY, fn: searchFirecrawl },
	{ name: "tavily",    key: process.env.TAVILY_API_KEY,    fn: searchTavily },
	{ name: "exa",       key: process.env.EXA_API_KEY,       fn: searchExa },
	{ name: "jina",      key: process.env.JINA_API_KEY,      fn: searchJina },
	{ name: "brave",     key: process.env.BRAVE_API_KEY,     fn: searchBrave },
	{ name: "ddg",       key: "free",                        fn: searchDuckDuckGo },
];

function getChain(): Provider[] {
	const mode = process.env.WEB_SEARCH_PROVIDER ?? "auto";
	if (mode === "auto") return PROVIDERS.filter(p => p.key);
	const p = PROVIDERS.find(p => p.name === mode);
	return p ? [p] : PROVIDERS.filter(p => p.key);
}

function formatResults(results: SearchResult[], query: string): string {
	if (!results.length) return `No results found for: ${query}`;
	return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
}

export default function (aery: ExtensionAPI) {
	aery.registerTool({
		name: "web_search",
		description: "Search the web. Providers auto-selected by priority (firecrawl > tavily > exa > jina > brave > duckduckgo). Control with WEB_SEARCH_PROVIDER env var.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
		}),
		renderResult(result, options, theme) {
			if (!result?.content) return new Text("Search complete", 0, 0);
			const details = result.details as any;
			if (result.isError) return new Text(theme.fg("toolOutput", "Search failed"), 0, 0);
			if (!options.expanded) {
				const summary = details?.count
					? `Found ${details.count} results via ${details.provider ?? "search"}`
					: "Search complete";
				return new Text(theme.fg("toolOutput", summary), 0, 0);
			}
			// Expanded: show full results
			const text = result.content.find((c: any) => c.type === "text")?.text ?? "";
			return new Text(theme.fg("toolOutput", text), 0, 0);
		},
		async execute(_id, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: `Searching: ${params.query}` }], details: {} });

			const chain = getChain();
			let lastError: any;
			for (const provider of chain) {
				try {
					const results = await provider.fn(params.query, signal);
					if (results.length > 0) {
						return {
							content: [{ type: "text" as const, text: formatResults(results, params.query) }],
							details: { query: params.query, provider: provider.name, count: results.length },
						};
					}
				} catch (e) {
					if ((e as any)?.name === "AbortError") throw e;
					lastError = e;
				}
			}
			return { content: [{ type: "text" as const, text: `Search failed: ${lastError?.message ?? "no results"}` }], details: {} };
		},
	});
}
