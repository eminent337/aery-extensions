import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";

// Enhanced browser tool with multi-step workflows, console checking, and form filling
const BrowserNavigateParams = Type.Object({
	url: Type.String({
		description: "The full http:// or https:// URL to navigate to."
	}),
	waitForSelector: Type.Optional(Type.String({
		description: "Optional CSS selector to wait for before returning (e.g. '.app-loaded', '#main')"
	})),
	waitMs: Type.Optional(Type.Number({
		description: "Optional milliseconds to wait after navigation before returning."
	}))
});

const BrowserClickParams = Type.Object({
	selector: Type.String({
		description: "CSS selector of the element to click."
	}),
	waitForNavigation: Type.Optional(Type.Boolean({
		description: "Whether to wait for a navigation event after clicking. Default false."
	}))
});

const BrowserFillParams = Type.Object({
	selector: Type.String({
		description: "CSS selector of the input field to fill."
	}),
	value: Type.String({
		description: "The text to type into the field."
	})
});

const BrowserExtractParams = Type.Object({
	selector: Type.Optional(Type.String({
		description: "Optional CSS selector to extract text from. If omitted, extracts the whole page text."
	})),
	attribute: Type.Optional(Type.String({
		description: "Optional attribute to extract (e.g. 'href', 'src'). If omitted, extracts inner text."
	}))
});

const BrowserConsoleParams = Type.Object({});

const BrowserScreenshotParams = Type.Object({
	fullPage: Type.Optional(Type.Boolean({
		description: "Whether to capture the full scrollable page. Default false."
	}))
});

const BrowserEvaluateParams = Type.Object({
	code: Type.String({
		description: "JavaScript code to execute in the browser page context."
	})
});

const BrowserCloseParams = Type.Object({});

export function registerBrowserEnhancedTools(aery: ExtensionAPI) {
	// Track browser state per session
	let browser: any = null;
	let page: any = null;
	let consoleLogs: string[] = [];

	const getPage = async () => {
		if (page) return page;
		try {
			const { chromium } = await import("playwright");
			browser = await chromium.launch({ headless: true });
			const context = await browser.newContext();
			page = await context.newPage();
			
			// Capture console logs
			page.on("console", (msg: any) => {
				consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
			});
			page.on("pageerror", (err: any) => {
				consoleLogs.push(`[PAGE_ERROR] ${err.message}`);
			});
			
			return page;
		} catch (err: any) {
			throw new Error(`Failed to launch browser: ${err.message}. Is playwright installed?`);
		}
	};

	// Navigate
	const navTool: ToolDefinition<typeof BrowserNavigateParams, { url: string; waitForSelector?: string; waitMs?: number }> = {
		name: "browser_navigate",
		label: "Browser Navigate",
		description: "Navigate the persistent browser to a specific URL.",
		parameters: BrowserNavigateParams,
		async execute(_id, params) {
			const p = await getPage();
			await p.goto(params.url, { waitUntil: "networkidle", timeout: 30000 });
			if (params.waitForSelector) {
				await p.waitForSelector(params.waitForSelector, { timeout: 10000 });
			}
			if (params.waitMs) {
				await new Promise(r => setTimeout(r, params.waitMs));
			}
			const title = await p.title();
			return {
				content: [{ type: "text", text: `Navigated to ${params.url}\nPage title: ${title}` }],
			};
		}
	};

	// Click
	const clickTool: ToolDefinition<typeof BrowserClickParams, { selector: string; waitForNavigation?: boolean }> = {
		name: "browser_click",
		label: "Browser Click",
		description: "Click an element on the browser page using a CSS selector.",
		parameters: BrowserClickParams,
		async execute(_id, params) {
			const p = await getPage();
			if (params.waitForNavigation) {
				await Promise.all([
					p.waitForNavigation({ waitUntil: "networkidle" }),
					p.click(params.selector),
				]);
			} else {
				await p.click(params.selector);
			}
			return {
				content: [{ type: "text", text: `Clicked element: ${params.selector}` }],
			};
		}
	};

	// Fill form field
	const fillTool: ToolDefinition<typeof BrowserFillParams, { selector: string; value: string }> = {
		name: "browser_fill",
		label: "Browser Fill",
		description: "Fill an input field on the browser page.",
		parameters: BrowserFillParams,
		async execute(_id, params) {
			const p = await getPage();
			await p.fill(params.selector, params.value);
			return {
				content: [{ type: "text", text: `Filled ${params.selector} with "${params.value}"` }],
			};
		}
	};

	// Extract text/content from page
	const extractTool: ToolDefinition<typeof BrowserExtractParams, { selector?: string; attribute?: string }> = {
		name: "browser_extract",
		label: "Browser Extract",
		description: "Extract text content or attributes from the browser page.",
		parameters: BrowserExtractParams,
		async execute(_id, params) {
			const p = await getPage();
			if (params.selector) {
				const els = await p.$$(params.selector);
				if (els.length === 0) {
					return { content: [{ type: "text", text: `No elements found matching: ${params.selector}` }] };
				}
				const results: string[] = [];
				for (let i = 0; i < Math.min(els.length, 50); i++) {
					if (params.attribute) {
						const val = await els[i].getAttribute(params.attribute);
						results.push(`${i}: ${val || "(no value)"}`);
					} else {
						const text = await els[i].textContent();
						results.push(`${i}: ${(text || "").trim().substring(0, 200)}`);
					}
				}
				return { content: [{ type: "text", text: `Found ${els.length} element(s):\n${results.join("\n")}` }] };
			} else {
				const text = await p.evaluate(() => document.body.innerText);
				return { content: [{ type: "text", text: (text || "").substring(0, 10000) }] };
			}
		}
	};

	// Get console errors
	const consoleTool: ToolDefinition<typeof BrowserConsoleParams, {}> = {
		name: "browser_console",
		label: "Browser Console",
		description: "Get captured console logs and errors from the browser session.",
		parameters: BrowserConsoleParams,
		async execute() {
			const logs = consoleLogs.slice();
			consoleLogs = [];
			if (logs.length === 0) {
				return { content: [{ type: "text", text: "No console logs captured." }] };
			}
			return { content: [{ type: "text", text: `Console logs (${logs.length}):\n${logs.join("\n")}` }] };
		}
	};

	// Screenshot
	const ssTool: ToolDefinition<typeof BrowserScreenshotParams, { fullPage?: boolean }> = {
		name: "browser_screenshot",
		label: "Browser Screenshot",
		description: "Take a screenshot of the current browser page.",
		parameters: BrowserScreenshotParams,
		async execute(_id, params) {
			const p = await getPage();
			const screenshot = await p.screenshot({ fullPage: params.fullPage || false });
			return {
				content: [{
					type: "image",
					data: (screenshot as Buffer).toString("base64"),
					mediaType: "image/png",
				}],
			};
		}
	};

	// Execute JavaScript
	const evalTool: ToolDefinition<typeof BrowserEvaluateParams, { code: string }> = {
		name: "browser_evaluate",
		label: "Browser Evaluate",
		description: "Execute JavaScript code in the browser page context and return the result.",
		parameters: BrowserEvaluateParams,
		async execute(_id, params) {
			const p = await getPage();
			const result = await p.evaluate(params.code);
			return {
				content: [{ type: "text", text: `Result:\n${JSON.stringify(result, null, 2).substring(0, 5000)}` }],
			};
		}
	};

	// Close browser
	const closeTool: ToolDefinition<typeof BrowserCloseParams, {}> = {
		name: "browser_close",
		label: "Browser Close",
		description: "Close the browser and release resources. Call this when done with browser automation.",
		parameters: BrowserCloseParams,
		async execute() {
			if (browser) {
				try {
					await browser.close();
				} catch {}
				browser = null;
				page = null;
				consoleLogs = [];
				return { content: [{ type: "text", text: "Browser closed successfully." }] };
			}
			return { content: [{ type: "text", text: "No browser session to close." }] };
		}
	};

	aery.registerTool(navTool);
	aery.registerTool(clickTool);
	aery.registerTool(fillTool);
	aery.registerTool(extractTool);
	aery.registerTool(consoleTool);
	aery.registerTool(ssTool);
	aery.registerTool(evalTool);
	aery.registerTool(closeTool);
}
