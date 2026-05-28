/**
 * Notebook Edit Tool — Edit Jupyter notebook (.ipynb) cells.
 * Supports replace, insert, and delete operations.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { ExtensionAPI } from "@aryee337/aery";
import { registerToolAliases } from "./tool-aliases.js";
import { Type } from "typebox";
import type { NotebookContent, NotebookCell } from "./types.js";

// Track read timestamps for read-before-write guard
const readTimestamps = new Map<string, number>();

export function registerNotebookEditTool(aery: ExtensionAPI): void {
	// Track when notebooks are read
	aery.on("tool_result", (event) => {
		if (
			event.toolName === "read" ||
			event.toolName === "FileReadTool"
		) {
			const input = event.input as any;
			const filePath = input?.file_path || input?.filePath;
			if (filePath && extname(filePath) === ".ipynb") {
				try {
					const stats = statSync(resolve(process.cwd(), filePath));
					readTimestamps.set(
						resolve(process.cwd(), filePath),
						stats.mtimeMs,
					);
				} catch {
					// Ignore
				}
			}
		}
	});

	aery.registerTool({
		name: "notebook_edit",
		description:
			"Edit Jupyter notebook (.ipynb) cells. Supports replace, insert, and delete operations.",
		promptSnippet: "edit Jupyter notebook cells",
		promptGuidelines: [
			"Use notebook_edit to modify .ipynb files cell by cell",
			"You must read the notebook first before editing it",
			"Use cell_id or cell_index to identify cells",
			"edit_mode can be 'replace' (default), 'insert', or 'delete'",
		],
		parameters: Type.Object({
			notebook_path: Type.String({
				description: "The absolute path to the Jupyter notebook file",
			}),
			cell_id: Type.Optional(
				Type.String({
					description: "The ID of the cell to edit",
				}),
			),
			cell_index: Type.Optional(
				Type.Number({
					description:
						"Numeric cell index (0-based, alternative to cell_id)",
				}),
			),
			new_source: Type.String({
				description: "The new source content for the cell",
			}),
			cell_type: Type.Optional(
				Type.Union([Type.Literal("code"), Type.Literal("markdown")], {
					description: "Cell type (required for insert mode)",
				}),
			),
			edit_mode: Type.Optional(
				Type.Union(
					[
						Type.Literal("replace"),
						Type.Literal("insert"),
						Type.Literal("delete"),
					],
					{ description: "Edit mode (default: replace)" },
				),
			),
		}),
		async execute(_id, params) {
			const notebookPath = resolve(
				process.cwd(),
				params.notebook_path,
			);

			// Validate file
			if (extname(notebookPath) !== ".ipynb") {
				return {
					content: [
						{
							type: "text" as const,
							text: "File must be a .ipynb notebook",
						},
					],
					isError: true,
				};
			}

			if (!existsSync(notebookPath)) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Notebook not found: ${params.notebook_path}`,
						},
					],
					isError: true,
				};
			}

			// Read-before-write guard
			const lastRead = readTimestamps.get(notebookPath);
			try {
				const stats = statSync(notebookPath);
				if (lastRead && stats.mtimeMs > lastRead) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Notebook has been modified since last read. Please read it again before editing.",
							},
						],
						isError: true,
					};
				}
			} catch {
				// Ignore stat errors
			}

			// Parse notebook
			let notebook: NotebookContent;
			try {
				const raw = readFileSync(notebookPath, "utf-8");
				notebook = JSON.parse(raw);
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to parse notebook: ${(e as Error).message}`,
						},
					],
					isError: true,
				};
			}

			if (!notebook.cells || !Array.isArray(notebook.cells)) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Invalid notebook format: no cells array found",
						},
					],
					isError: true,
				};
			}

			const editMode = params.edit_mode ?? "replace";
			const cells = notebook.cells;

			// Find target cell index
			let cellIndex: number | undefined;

			if (params.cell_id !== undefined) {
				cellIndex = cells.findIndex(
					(c) => c.id === params.cell_id,
				);
				if (cellIndex === -1) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Cell not found with ID: ${params.cell_id}`,
							},
						],
						isError: true,
					};
				}
			} else if (params.cell_index !== undefined) {
				cellIndex = params.cell_index;
				if (cellIndex < 0 || cellIndex >= cells.length) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Cell index ${cellIndex} out of range (0-${cells.length - 1})`,
							},
						],
						isError: true,
					};
				}
			}

			// Apply edit
			switch (editMode) {
				case "replace": {
					if (cellIndex === undefined) {
						return {
							content: [
								{
									type: "text" as const,
									text: "cell_id or cell_index is required for replace mode",
								},
							],
							isError: true,
						};
					}
					const cell = cells[cellIndex]!;
					cell.source = params.new_source;
					if (params.cell_type) cell.cell_type = params.cell_type;
					if (cell.cell_type === "code") {
						cell.execution_count = null;
						cell.outputs = [];
					}
					break;
				}

				case "insert": {
					if (params.cell_type === undefined) {
						return {
							content: [
								{
									type: "text" as const,
									text: "cell_type is required for insert mode",
								},
							],
							isError: true,
						};
					}
					const insertIndex =
						cellIndex !== undefined ? cellIndex + 1 : 0;
					const newCell: NotebookCell = {
						cell_type: params.cell_type,
						source: params.new_source,
						metadata: {},
					};
					// Generate cell ID for nbformat >= 4.5
					if (
						notebook.nbformat > 4 ||
						(notebook.nbformat === 4 &&
							notebook.nbformat_minor >= 5)
					) {
						newCell.id = Math.random()
							.toString(36)
							.substring(2, 15);
					}
					if (params.cell_type === "code") {
						newCell.outputs = [];
						newCell.execution_count = null;
					}
					cells.splice(insertIndex, 0, newCell);
					break;
				}

				case "delete": {
					if (cellIndex === undefined) {
						return {
							content: [
								{
									type: "text" as const,
									text: "cell_id or cell_index is required for delete mode",
								},
							],
							isError: true,
						};
					}
					cells.splice(cellIndex, 1);
					break;
				}
			}

			// Write back
			try {
				writeFileSync(
					notebookPath,
					JSON.stringify(notebook, null, 1) + "\n",
				);
				// Update read timestamp
				readTimestamps.set(notebookPath, Date.now());
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to write notebook: ${(e as Error).message}`,
						},
					],
					isError: true,
				};
			}

			const lang =
				notebook.metadata.language_info?.name ?? "unknown";
			return {
				content: [
					{
						type: "text" as const,
						text: `Notebook ${editMode} completed. Cell count: ${cells.length}, Language: ${lang}`,
					},
				],
				details: {
					edit_mode: editMode,
					cell_count: cells.length,
					language: lang,
				},
			};
		},
	});
	registerToolAliases(aery, { notebook_edit: "NotebookEdit" });
}
