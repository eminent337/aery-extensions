/**
 * LSP Result Formatters
 * Formats LSP protocol responses into human-readable text.
 */

import { relative } from "node:path";
import type {
	Location,
	LocationLink,
	DocumentSymbol,
	SymbolInformation,
	Hover,
	MarkupContent,
	MarkedString,
	CallHierarchyItem,
	CallHierarchyIncomingCall,
	CallHierarchyOutgoingCall,
	SymbolKind,
} from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUri(uri: string | undefined, cwd?: string): string {
	if (!uri) return "<unknown location>";
	let filePath = uri.replace(/^file:\/\//, "");
	if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
	try {
		filePath = decodeURIComponent(filePath);
	} catch {
		// Use un-decoded path
	}
	if (cwd) {
		const rel = relative(cwd, filePath).replaceAll("\\", "/");
		if (rel.length < filePath.length && !rel.startsWith("../../")) {
			return rel;
		}
	}
	return filePath.replaceAll("\\", "/");
}

function formatLocation(location: Location, cwd?: string): string {
	const filePath = formatUri(location.uri, cwd);
	const line = location.range.start.line + 1;
	const character = location.range.start.character + 1;
	return `${filePath}:${line}:${character}`;
}

function isLocationLink(
	item: Location | LocationLink,
): item is LocationLink {
	return "targetUri" in item;
}

function locationLinkToLocation(link: LocationLink): Location {
	return {
		uri: link.targetUri,
		range: link.targetSelectionRange || link.targetRange,
	};
}

function groupByFile<T extends { uri: string } | { location: { uri: string } }>(
	items: T[],
	cwd?: string,
): Map<string, T[]> {
	const byFile = new Map<string, T[]>();
	for (const item of items) {
		const uri = "uri" in item ? item.uri : item.location.uri;
		const filePath = formatUri(uri, cwd);
		const existing = byFile.get(filePath);
		if (existing) {
			existing.push(item);
		} else {
			byFile.set(filePath, [item]);
		}
	}
	return byFile;
}

function symbolKindToString(kind: SymbolKind): string {
	const kinds: Record<number, string> = {
		1: "File", 2: "Module", 3: "Namespace", 4: "Package",
		5: "Class", 6: "Method", 7: "Property", 8: "Field",
		9: "Constructor", 10: "Enum", 11: "Interface", 12: "Function",
		13: "Variable", 14: "Constant", 15: "String", 16: "Number",
		17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
		21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
		25: "Operator", 26: "TypeParameter",
	};
	return kinds[kind] ?? "Symbol";
}

function extractMarkupText(
	contents: MarkupContent | MarkedString | MarkedString[],
): string {
	if (Array.isArray(contents)) {
		return contents
			.map((item) => (typeof item === "string" ? item : item.value))
			.join("\n\n");
	}
	if (typeof contents === "string") return contents;
	if ("kind" in contents) return contents.value;
	return contents.value;
}

function plural(count: number, singular: string, plural?: string): string {
	return count === 1 ? singular : (plural ?? `${singular}s`);
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export function formatGoToDefinitionResult(
	result:
		| Location
		| Location[]
		| LocationLink
		| LocationLink[]
		| null,
	cwd?: string,
): string {
	if (!result) {
		return "No definition found. The cursor may not be on a symbol, or the definition is in an external library.";
	}

	if (Array.isArray(result)) {
		const locations: Location[] = result.map((item) =>
			isLocationLink(item) ? locationLinkToLocation(item) : item,
		);
		const valid = locations.filter((loc) => loc?.uri);
		if (valid.length === 0) return "No definition found.";
		if (valid.length === 1)
			return `Defined in ${formatLocation(valid[0]!, cwd)}`;
		return `Found ${valid.length} definitions:\n${valid.map((l) => `  ${formatLocation(l, cwd)}`).join("\n")}`;
	}

	const location = isLocationLink(result)
		? locationLinkToLocation(result)
		: result;
	return `Defined in ${formatLocation(location, cwd)}`;
}

export function formatFindReferencesResult(
	result: Location[] | null,
	cwd?: string,
): string {
	if (!result || result.length === 0) {
		return "No references found.";
	}

	const valid = result.filter((loc) => loc?.uri);
	if (valid.length === 0) return "No references found.";

	if (valid.length === 1) {
		return `Found 1 reference:\n  ${formatLocation(valid[0]!, cwd)}`;
	}

	const byFile = groupByFile(valid, cwd);
	const lines: string[] = [
		`Found ${valid.length} references across ${byFile.size} files:`,
	];

	for (const [filePath, locations] of byFile) {
		lines.push(`\n${filePath}:`);
		for (const loc of locations) {
			const line = loc.range.start.line + 1;
			const character = loc.range.start.character + 1;
			lines.push(`  Line ${line}:${character}`);
		}
	}

	return lines.join("\n");
}

export function formatHoverResult(
	result: Hover | null,
	_cwd?: string,
): string {
	if (!result) {
		return "No hover information available.";
	}

	const content = extractMarkupText(result.contents);

	if (result.range) {
		const line = result.range.start.line + 1;
		const character = result.range.start.character + 1;
		return `Hover info at ${line}:${character}:\n\n${content}`;
	}

	return content;
}

export function formatDocumentSymbolResult(
	result: DocumentSymbol[] | SymbolInformation[] | null,
	cwd?: string,
): string {
	if (!result || result.length === 0) {
		return "No symbols found in this file.";
	}

	// Check if it's DocumentSymbol[] (hierarchical) or SymbolInformation[] (flat)
	if (result.length > 0 && "children" in result[0]!) {
		return formatDocumentSymbolTree(result as DocumentSymbol[], 0, cwd);
	}

	// Flat SymbolInformation[]
	const symbols = result as SymbolInformation[];
	const lines = symbols.map((s) => {
		const kind = symbolKindToString(s.kind);
		const loc = formatLocation(s.location, cwd);
		const container = s.containerName ? ` (${s.containerName})` : "";
		return `  ${kind}: ${s.name}${container} — ${loc}`;
	});

	return `Found ${symbols.length} ${plural(symbols.length, "symbol")}:\n${lines.join("\n")}`;
}

function formatDocumentSymbolTree(
	symbols: DocumentSymbol[],
	depth: number,
	_cwd?: string,
): string {
	const lines: string[] = [];
	const indent = "  ".repeat(depth);

	for (const s of symbols) {
		const kind = symbolKindToString(s.kind);
		const line = s.range.start.line + 1;
		const detail = s.detail ? ` — ${s.detail}` : "";
		lines.push(`${indent}${kind}: ${s.name}${detail} (line ${line})`);

		if (s.children && s.children.length > 0) {
			lines.push(formatDocumentSymbolTree(s.children, depth + 1, _cwd));
		}
	}

	return lines.join("\n");
}

export function formatWorkspaceSymbolResult(
	result: SymbolInformation[] | null,
	cwd?: string,
): string {
	if (!result || result.length === 0) {
		return "No workspace symbols found.";
	}

	const lines = result.slice(0, 50).map((s) => {
		const kind = symbolKindToString(s.kind);
		const loc = formatLocation(s.location, cwd);
		const container = s.containerName ? ` (${s.containerName})` : "";
		return `  ${kind}: ${s.name}${container} — ${loc}`;
	});

	const total = result.length;
	const shown = Math.min(total, 50);
	const suffix = total > 50 ? `\n  ... and ${total - 50} more` : "";

	return `Found ${total} ${plural(total, "symbol")}:\n${lines.join("\n")}${suffix}`;
}

export function formatPrepareCallHierarchyResult(
	result: CallHierarchyItem[] | null,
	cwd?: string,
): string {
	if (!result || result.length === 0) {
		return "No call hierarchy item found at this position.";
	}

	const lines = result.map((item) => {
		const kind = symbolKindToString(item.kind);
		const loc = formatLocation(
			{ uri: item.uri, range: item.range },
			cwd,
		);
		const detail = item.detail ? ` — ${item.detail}` : "";
		return `  ${kind}: ${item.name}${detail} at ${loc}`;
	});

	return `Call hierarchy items:\n${lines.join("\n")}`;
}

export function formatIncomingCallsResult(
	result: CallHierarchyIncomingCall[] | null,
	cwd?: string,
): string {
	if (!result || result.length === 0) {
		return "No callers found.";
	}

	const lines: string[] = [
		`Found ${result.length} ${plural(result.length, "caller")}:`,
	];

	for (const call of result) {
		const kind = symbolKindToString(call.from.kind);
		const loc = formatLocation(
			{ uri: call.from.uri, range: call.from.range },
			cwd,
		);
		lines.push(`\n${kind}: ${call.from.name} at ${loc}`);
		for (const range of call.fromRanges) {
			lines.push(
				`  Called at line ${range.start.line + 1}:${range.start.character + 1}`,
			);
		}
	}

	return lines.join("\n");
}

export function formatOutgoingCallsResult(
	result: CallHierarchyOutgoingCall[] | null,
	cwd?: string,
): string {
	if (!result || result.length === 0) {
		return "No outgoing calls found.";
	}

	const lines: string[] = [
		`Found ${result.length} outgoing ${plural(result.length, "call")}:`,
	];

	for (const call of result) {
		const kind = symbolKindToString(call.to.kind);
		const loc = formatLocation(
			{ uri: call.to.uri, range: call.to.range },
			cwd,
		);
		lines.push(`\n${kind}: ${call.to.name} at ${loc}`);
		for (const range of call.fromRanges) {
			lines.push(
				`  Calls at line ${range.start.line + 1}:${range.start.character + 1}`,
			);
		}
	}

	return lines.join("\n");
}
