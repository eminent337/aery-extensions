/**
 * Aery Web Fetch Tool (Phase 1.3)
 * Fetches a URL and returns content as markdown.
 * Uses Firecrawl if FIRECRAWL_API_KEY is set, otherwise plain fetch + html-to-markdown.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "@sinclair/typebox";

const MAX_BYTES = 50_000;

function htmlToMarkdown(html: string): string {
	// Strip scripts, styles, nav, footer, header elements
	html = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<nav[\s\S]*?<\/nav>/gi, "")
		.replace(/<footer[\s\S]*?<\/footer>/gi, "")
		.replace(/<header[\s\S]*?<\/header>/gi, "");

	// Convert common tags to markdown
	html = html
		.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
		.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
		.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
		.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n#### $1\n")
		.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
		.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
		.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
		.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
		.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
		.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
		.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
		.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
		.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return html;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_fetch",
		description: "Fetch a URL and return its content as markdown. Use for reading documentation, articles, or any web page.",
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			prompt: Type.Optional(Type.String({ description: "What to extract from the page (optional)" })),
		}),
		async execute(_id, params, signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: `Fetching ${params.url}...` }], details: {} });

			// Firecrawl path
			if (process.env.FIRECRAWL_API_KEY) {
				try {
					const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
						method: "POST",
						headers: {
							"Authorization": `Bearer ${process.env.FIRECRAWL_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ url: params.url, formats: ["markdown"] }),
						signal,
					});
					const data = await res.json() as any;
					const markdown = data?.data?.markdown ?? data?.markdown ?? "";
					if (markdown) {
						const truncated = markdown.length > MAX_BYTES ? markdown.slice(0, MAX_BYTES) + "\n\n[truncated]" : markdown;
						return { content: [{ type: "text" as const, text: truncated }], details: { url: params.url, bytes: markdown.length, source: "firecrawl" } };
					}
				} catch {}
			}

			// Plain fetch path
			const res = await fetch(params.url, {
				signal,
				headers: { "User-Agent": "Mozilla/5.0 (compatible; Aery/1.0)" },
			});

			if (!res.ok) {
				return { content: [{ type: "text" as const, text: `HTTP ${res.status}: ${res.statusText}` }], details: { url: params.url, bytes: 0 } };
			}

			const contentType = res.headers.get("content-type") ?? "";
			let text: string;

			if (contentType.includes("text/html")) {
				const html = await res.text();
				text = htmlToMarkdown(html);
			} else {
				text = await res.text();
			}

			const truncated = text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) + "\n\n[truncated — content exceeds 50KB]" : text;

			return {
				content: [{ type: "text" as const, text: truncated }],
				details: { url: params.url, bytes: text.length },
			};
		},
	});
}
