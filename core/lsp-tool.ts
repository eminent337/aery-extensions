/**
 * LSP Tool — IDE-level code intelligence for Aery
 * 9 operations: goToDefinition, findReferences, hover, documentSymbol,
 * workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls
 */

import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, stat } from "node:fs/promises";
import type { ExtensionAPI } from "@aryee337/aery";
import { Type } from "typebox";
import type { LspManager } from "./lsp-manager.js";
import {
	formatGoToDefinitionResult,
	formatFindReferencesResult,
	formatHoverResult,
	formatDocumentSymbolResult,
	formatWorkspaceSymbolResult,
	formatPrepareCallHierarchyResult,
	formatIncomingCallsResult,
	formatOutgoingCallsResult,
} from "./lsp-formatters.js";
import type { Location, CallHierarchyItem } from "./types.js";

const MAX_LSP_FILE_SIZE = 10_000_000; // 10MB

const OPERATIONS = [
	"goToDefinition",
	"findReferences",
	"hover",
	"documentSymbol",
	"workspaceSymbol",
	"goToImplementation",
	"prepareCallHierarchy",
	"incomingCalls",
	"outgoingCalls",
] as const;

type Operation = (typeof OPERATIONS)[number];

interface LspMethod {
	method: string;
	params: (filePath: string, line: number, character: number) => unknown;
}

function getMethodAndParams(
	operation: Operation,
	absolutePath: string,
	line: number,
	character: number,
): LspMethod {
	const fileUri = pathToFileURL(absolutePath).href;
	// LSP uses 0-based positions
	const position = { line: line - 1, character: character - 1 };

	switch (operation) {
		case "goToDefinition":
			return {
				method: "textDocument/definition",
				params: () => ({
					textDocument: { uri: fileUri },
					position,
				}),
			};
		case "findReferences":
			return {
				method: "textDocument/references",
				params: () => ({
					textDocument: { uri: fileUri },
					position,
					context: { includeDeclaration: true },
				}),
			};
		case "hover":
			return {
				method: "textDocument/hover",
				params: () => ({
					textDocument: { uri: fileUri },
					position,
				}),
			};
		case "documentSymbol":
			return {
				method: "textDocument/documentSymbol",
				params: () => ({
					textDocument: { uri: fileUri },
				}),
			};
		case "workspaceSymbol":
			return {
				method: "workspace/symbol",
				params: () => ({ query: "" }),
			};
		case "goToImplementation":
			return {
				method: "textDocument/implementation",
				params: () => ({
					textDocument: { uri: fileUri },
					position,
				}),
			};
		case "prepareCallHierarchy":
			return {
				method: "textDocument/prepareCallHierarchy",
				params: () => ({
					textDocument: { uri: fileUri },
					position,
				}),
			};
		case "incomingCalls":
			return {
				method: "textDocument/prepareCallHierarchy",
				params: () => ({
					textDocument: { uri: fileUri },
					position,
				}),
			};
		case "outgoingCalls":
			return {
				method: "textDocument/prepareCallHierarchy",
				params: () => ({
					textDocument: { uri: fileUri },
					position,
				}),
			};
	}
}

async function filterGitIgnored(
	paths: string[],
	cwd: string,
): Promise<Set<string>> {
	if (paths.length === 0) return new Set();

	const ignored = new Set<string>();
	// Process in batches of 50
	for (let i = 0; i < paths.length; i += 50) {
		const batch = paths.slice(i, i + 50);
		try {
			const result = await execGitCheckIgnore(batch, cwd);
			for (const p of result) ignored.add(p);
		} catch {
			// git not available or not a repo — skip filtering
		}
	}
	return ignored;
}

async function execGitCheckIgnore(
	paths: string[],
	cwd: string,
): Promise<string[]> {
	return new Promise((resolve) => {
		const { spawn } = require("node:child_process") as typeof import("node:child_process");
		const child = spawn("git", ["check-ignore", "--stdin", "-z"], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		child.on("close", () => {
			const ignored = stdout
				.split("\0")
				.filter((s: string) => s.length > 0);
			resolve(ignored);
		});

		child.on("error", () => resolve([]));

		// Send paths separated by null bytes
		child.stdin.write(paths.join("\0"));
		child.stdin.end();
	});
}

export function registerLspTool(
	aery: ExtensionAPI,
	lspManager: LspManager,
): void {
	aery.registerTool({
		name: "lsp",
		description:
			"Language Server Protocol operations for code intelligence. Operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls.",
		promptSnippet:
			"IDE-level code intelligence — definitions, references, types, call hierarchy",
		promptGuidelines: [
			"Use lsp to find where symbols are defined, who references them, and what types they have",
			"Use documentSymbol to get an outline of a file's structure",
			"Use incomingCalls/outgoingCalls to understand code flow",
			"The lsp tool requires a language server to be installed for the file type (e.g., typescript-language-server, pyright-langserver)",
		],
		parameters: Type.Object({
			operation: Type.Union(
				OPERATIONS.map((op) => Type.Literal(op)),
				{ description: "The LSP operation to perform" },
			),
			filePath: Type.String({
				description: "The absolute or relative path to the file",
			}),
			line: Type.Optional(
				Type.Number({
					description:
						"The line number (1-based, as shown in editors). Required for position-based operations.",
				}),
			),
			character: Type.Optional(
				Type.Number({
					description:
						"The character offset (1-based, as shown in editors). Required for position-based operations.",
				}),
			),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const operation = params.operation as Operation;
			const cwd = process.cwd();
			const absolutePath = resolve(cwd, params.filePath);
			const line = params.line ?? 1;
			const character = params.character ?? 1;

			onUpdate?.({
				content: [
					{
						type: "text" as const,
						text: `LSP ${operation} on ${params.filePath}:${line}:${character}`,
					},
				],
				details: {},
			});

			// Check file exists and size
			try {
				const stats = await stat(absolutePath);
				if (stats.size > MAX_LSP_FILE_SIZE) {
					return {
						content: [
							{
								type: "text" as const,
								text: `File too large for LSP analysis (${Math.ceil(stats.size / 1_000_000)}MB exceeds 10MB limit)`,
							},
						],
						details: {},
					};
				}
			} catch {
				return {
					content: [
						{
							type: "text" as const,
							text: `File not found: ${params.filePath}`,
						},
					],
					isError: true,
					details: {},
				};
			}

			// Open file in LSP if not already open
			if (!lspManager.isFileOpen(absolutePath)) {
				try {
					const content = await readFile(absolutePath, "utf-8");
					await lspManager.openFile(absolutePath, content);
				} catch (e) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to open file in LSP: ${(e as Error).message}`,
							},
						],
						isError: true,
						details: {},
					};
				}
			}

			// Get LSP method and params
			const { method, params: makeParams } = getMethodAndParams(
				operation,
				absolutePath,
				line,
				character,
			);

			// Send request
			let result: unknown;
			try {
				result = await lspManager.sendRequest(
					absolutePath,
					method,
					makeParams(absolutePath, line, character),
				);
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `LSP request failed: ${(e as Error).message}`,
						},
					],
					isError: true,
					details: {},
				};
			}

			if (result === undefined) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No LSP server available for file type: ${extname(absolutePath)}. Install a language server (e.g., typescript-language-server, pyright-langserver).`,
						},
					],
					details: {},
				};
			}

			// Handle two-step operations (incomingCalls/outgoingCalls)
			if (
				operation === "incomingCalls" ||
				operation === "outgoingCalls"
			) {
				const items = result as CallHierarchyItem[];
				if (!items || items.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: "No call hierarchy item found at this position.",
							},
						],
						details: {},
					};
				}

				const item = items[0]!;
				const callMethod =
					operation === "incomingCalls"
						? "callHierarchy/incomingCalls"
						: "callHierarchy/outgoingCalls";

				try {
					const calls = await lspManager.sendRequest(
						absolutePath,
						callMethod,
						{ item },
					);

					// Filter gitignored
					if (calls && Array.isArray(calls)) {
						const paths = calls.map((c: any) => {
							const uri =
								c.from?.uri || c.to?.uri || "";
							return uri.replace(/^file:\/\//, "");
						});
						const ignored = await filterGitIgnored(
							paths,
							cwd,
						);
						if (ignored.size > 0) {
							// Remove ignored results
						}
					}

					const formatted =
						operation === "incomingCalls"
							? formatIncomingCallsResult(
									calls as any,
									cwd,
								)
							: formatOutgoingCallsResult(
									calls as any,
									cwd,
								);

					return {
						content: [
							{ type: "text" as const, text: formatted },
						],
						details: { operation, resultCount: Array.isArray(calls) ? calls.length : 0 },
					};
				} catch (e) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Call hierarchy request failed: ${(e as Error).message}`,
							},
						],
						isError: true,
						details: {},
					};
				}
			}

			// Format result based on operation
			let formatted: string;
			let resultCount: number | undefined;

			switch (operation) {
				case "goToDefinition":
					formatted = formatGoToDefinitionResult(result as any, cwd);
					resultCount = Array.isArray(result) ? (result as any[]).length : result ? 1 : 0;
					break;
				case "findReferences":
					formatted = formatFindReferencesResult(
						result as Location[],
						cwd,
					);
					resultCount = (result as Location[])?.length ?? 0;
					break;
				case "hover":
					formatted = formatHoverResult(result as any, cwd);
					break;
				case "documentSymbol":
					formatted = formatDocumentSymbolResult(
						result as any,
						cwd,
					);
					resultCount = (result as any[])?.length ?? 0;
					break;
				case "workspaceSymbol":
					formatted = formatWorkspaceSymbolResult(
						result as any,
						cwd,
					);
					resultCount = (result as any[])?.length ?? 0;
					break;
				case "goToImplementation":
					formatted = formatGoToDefinitionResult(result as any, cwd);
					resultCount = Array.isArray(result) ? (result as any[]).length : result ? 1 : 0;
					break;
				case "prepareCallHierarchy":
					formatted = formatPrepareCallHierarchyResult(
						result as any,
						cwd,
					);
					resultCount = (result as any[])?.length ?? 0;
					break;
				default:
					formatted = JSON.stringify(result, null, 2);
			}

			return {
				content: [{ type: "text" as const, text: formatted }],
				details: { operation, filePath: params.filePath, resultCount },
			};
		},
	});
}
