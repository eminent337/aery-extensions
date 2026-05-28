/**
 * Aery Circuit Breaker
 * Stops the agent if the same tool fails 3x in a row.
 * Prevents infinite error loops burning tokens.
 */

import type { ExtensionAPI } from "@aryee337/aery";

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_TOOL_RESULT_CHARS = 20_000; // ~5K tokens
const MAX_EXTENSION_TOOL_TEXT_CHARS = 1_500;
const BUILTIN_TOOL_NAMES = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);

type ToolContent = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string };

export function isBuiltinToolName(toolName: string): boolean {
	return BUILTIN_TOOL_NAMES.has(toolName);
}

function compactPreview(text: string, maxLength = 80): string {
	const squashed = text.replace(/\s+/g, " ").trim();
	return squashed.length > maxLength ? `${squashed.slice(0, maxLength)}...` : squashed;
}

function detectTextKind(text: string): string {
	const trimmed = text.trimStart();
	if (/^<!doctype html>|^<html\b|^<body\b|^<div\b/i.test(trimmed)) return "HTML result";
	if (/^[\[{]/.test(trimmed)) return "JSON result";
	if (/^#include |^import |^from |^function |^class /m.test(trimmed)) return "code result";
	return "text result";
}

export function compactToolResultContent(toolName: string, content: ToolContent[]): ToolContent[] {
	if (isBuiltinToolName(toolName)) return content;

	return content.map((item) => {
		if (item.type !== "text") return item;
		if (item.text.length <= MAX_EXTENSION_TOOL_TEXT_CHARS) return item;

		const kind = detectTextKind(item.text);
		const compacted = [
			`[${toolName}] Output compacted.`,
			`${kind} length: ${item.text.length} chars.`,
			`Preview: ${compactPreview(item.text)}`,
			`Use a tool-specific raw/full option if you need the complete payload.`,
		].join("\n");
		return { type: "text", text: compacted };
	});
}

export default function (aery: ExtensionAPI) {
	// Track consecutive failures per tool
	const failures = new Map<string, number>();

	aery.on("before_agent_start", async () => {
		failures.clear(); // reset on new user message
	});

	aery.on("tool_result", async (event, ctx) => {
		const toolName = event.toolName ?? "unknown";
		const isError = event.isError;
		const compactedContent = compactToolResultContent(toolName, event.content as ToolContent[]);
		const contentChanged = JSON.stringify(compactedContent) !== JSON.stringify(event.content);

		// Warn on oversized tool results that could overflow context
		const resultStr = JSON.stringify(event.content ?? "");
		if (resultStr.length > MAX_TOOL_RESULT_CHARS) {
			ctx.ui.notify(
				`Large tool result: ${toolName} returned ${Math.round(resultStr.length / 1000)}KB — context may fill up`,
				"warning"
			);
		}

		if (isError) {
			const count = (failures.get(toolName) ?? 0) + 1;
			failures.set(toolName, count);

			if (count >= MAX_CONSECUTIVE_FAILURES) {
				ctx.ui.notify(
					`Circuit breaker: ${toolName} failed ${count}x in a row. Stopping to prevent infinite loop.`,
					"error"
				);
				aery.sendUserMessage(
					`[circuit-breaker] The tool "${toolName}" has failed ${count} times consecutively. ` +
					`Stop retrying this approach. Report what went wrong and suggest an alternative strategy.`,
					{ deliverAs: "followUp" }
				);
				failures.delete(toolName); // reset after firing
			}
		} else {
			failures.delete(toolName); // reset on success
		}

		if (contentChanged) {
			return { content: compactedContent };
		}
	});
}
