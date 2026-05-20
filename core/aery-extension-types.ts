/**
 * Aery Extension Pack — Shared Types
 * Types for LSP, MCP, Notebook, and Cron subsystems.
 */

// ─── LSP Types ───────────────────────────────────────────────────────────────

export interface LspServerConfig {
	command: string;
	args: string[];
	fileExtensions: string[];
	env?: Record<string, string>;
}

export interface LspServersConfig {
	servers: Record<string, LspServerConfig>;
}

export type LspServerState = "stopped" | "starting" | "running" | "error";

export interface LspServerInfo {
	name: string;
	config: LspServerConfig;
	state: LspServerState;
	pid?: number;
}

// LSP protocol types (subset of vscode-languageserver-types)
export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export interface Location {
	uri: string;
	range: Range;
}

export interface LocationLink {
	targetUri: string;
	targetRange: Range;
	targetSelectionRange?: Range;
}

export interface TextDocumentIdentifier {
	uri: string;
}

export interface VersionedTextDocumentIdentifier {
	uri: string;
	version: number;
}

export interface TextDocumentItem {
	uri: string;
	languageId: string;
	version: number;
	text: string;
}

export interface Hover {
	contents: MarkupContent | MarkedString | MarkedString[];
	range?: Range;
}

export type MarkedString = string | { language: string; value: string };

export interface MarkupContent {
	kind: "markdown" | "plaintext";
	value: string;
}

export type SymbolKind = number;

export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: SymbolKind;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
}

export interface SymbolInformation {
	name: string;
	kind: SymbolKind;
	location: Location;
	containerName?: string;
}

export interface CallHierarchyItem {
	name: string;
	kind: SymbolKind;
	uri: string;
	range: Range;
	selectionRange: Range;
	detail?: string;
}

export interface CallHierarchyIncomingCall {
	from: CallHierarchyItem;
	fromRanges: Range[];
}

export interface CallHierarchyOutgoingCall {
	to: CallHierarchyItem;
	fromRanges: Range[];
}

// ─── MCP Types ───────────────────────────────────────────────────────────────

export interface McpServerConfig {
	type?: "stdio" | "http" | "sse";
	command?: string;
	args?: string[];
	url?: string;
	headers?: Record<string, string>;
	env?: Record<string, string>;
}

export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolDef {
	name: string;
	serverName: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

// ─── Notebook Types ──────────────────────────────────────────────────────────

export interface NotebookContent {
	nbformat: number;
	nbformat_minor: number;
	metadata: {
		language_info?: { name: string };
		[k: string]: unknown;
	};
	cells: NotebookCell[];
}

export interface NotebookCell {
	id?: string;
	cell_type: "code" | "markdown";
	source: string | string[];
	metadata: Record<string, unknown>;
	outputs?: unknown[];
	execution_count?: number | null;
}

// ─── Cron Types ──────────────────────────────────────────────────────────────

export interface CronJob {
	id: string;
	cron: string;
	prompt: string;
	recurring: boolean;
	durable: boolean;
	createdAt: string;
	lastFired?: string;
}

export interface CronFields {
	minute: number[];
	hour: number[];
	dayOfMonth: number[];
	month: number[];
	dayOfWeek: number[];
}
