/**
 * File History Extension
 *
 * Tracks files modified by the agent and creates pre-edit backups.
 * Supports rewind to a previous session entry.
 *
 * Backups stored in: ~/.aery/file-history/{sessionId}/{hash}@v{N}
 */

import {
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	copyFileSync,
	readdirSync,
	statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

const HISTORY_DIR = join(homedir(), ".aery", "file-history");

interface FileSnapshot {
	path: string;
	hash: string;
	version: number;
	timestamp: string;
	size: number;
}

interface TurnSnapshot {
	entryId: string;
	timestamp: string;
	files: FileSnapshot[];
}

// In-memory state
const fileVersions = new Map<string, number>(); // filePath -> version
const snapshots: TurnSnapshot[] = [];
let sessionId: string = "";

function getHistoryDir(): string {
	const dir = join(HISTORY_DIR, sessionId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function backupFile(filePath: string): FileSnapshot | null {
	try {
		if (!existsSync(filePath)) return null;

		const content = readFileSync(filePath, "utf-8");
		const hash = hashContent(content);
		const version = (fileVersions.get(filePath) ?? 0) + 1;
		fileVersions.set(filePath, version);

		const backupPath = join(
			getHistoryDir(),
			`${hash}@v${version}`,
		);

		copyFileSync(filePath, backupPath);

		return {
			path: filePath,
			hash,
			version,
			timestamp: new Date().toISOString(),
			size: content.length,
		};
	} catch {
		return null;
	}
}

export default function fileHistory(pi: ExtensionAPI): void {
	// Capture session ID
	pi.on("session_start", (event) => {
		// Generate a simple session ID from timestamp
		sessionId = `session-${Date.now()}`;
		fileVersions.clear();
		snapshots.length = 0;
	});

	// Track files modified by edit/write tools
	pi.on("tool_call", (event) => {
		const toolName = event.toolName.toLowerCase();
		const input = event.input as any;

		if (toolName === "edit" || toolName === "write") {
			const filePath = input?.file_path || input?.filePath;
			if (filePath) {
				backupFile(filePath);
			}
		}
	});

	// Create snapshot at turn end
	pi.on("turn_end", (event) => {
		const files: FileSnapshot[] = [];
		for (const [path, version] of fileVersions) {
			files.push({
				path,
				hash: `v${version}`,
				version,
				timestamp: new Date().toISOString(),
				size: 0,
			});
		}

		if (files.length > 0) {
			snapshots.push({
				entryId: `turn-${event.turnIndex}`,
				timestamp: new Date().toISOString(),
				files: [...files],
			});
		}
	});

	// Register rewind tool
	pi.registerTool({
		name: "file_history_rewind",
		description:
			"Rewind files to a previous snapshot. Restores all files that were modified since that point.",
		promptSnippet: "undo file changes by rewinding to a previous state",
		promptGuidelines: [
			"Use file_history_rewind to undo agent file changes",
			"Specify a turn index to rewind to",
			"All files modified after that turn will be restored",
		],
		parameters: Type.Object({
			turn_index: Type.Number({
				description: "The turn index to rewind to (0-based)",
			}),
		}),
		async execute(_id, params) {
			const targetIndex = params.turn_index;
			const targetSnapshot = snapshots.find(
				(s) => s.entryId === `turn-${targetIndex}`,
			);

			if (!targetSnapshot) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No snapshot found for turn ${targetIndex}. Available turns: ${snapshots.map((s) => s.entryId).join(", ")}`,
						},
					],
					isError: true,
				};
			}

			let restored = 0;
			const errors: string[] = [];

			for (const file of targetSnapshot.files) {
				try {
					const historyDir = getHistoryDir();
					const backups = readdirSync(historyDir)
						.filter((f) => f.startsWith(file.hash))
						.sort();

					if (backups.length > 0) {
						const backupPath = join(
							historyDir,
							backups[backups.length - 1]!,
						);
						copyFileSync(backupPath, file.path);
						restored++;
					}
				} catch (e) {
					errors.push(
						`${file.path}: ${(e as Error).message}`,
					);
				}
			}

			const msg = [
				`Rewound to turn ${targetIndex}. Restored ${restored} files.`,
			];
			if (errors.length > 0) {
				msg.push(`Errors:\n${errors.join("\n")}`);
			}

			return {
				content: [{ type: "text" as const, text: msg.join("\n") }],
			};
		},
	});

	// Register history list tool
	pi.registerTool({
		name: "file_history_list",
		description: "List all file history snapshots.",
		parameters: Type.Object({}),
		async execute() {
			if (snapshots.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No file history snapshots.",
						},
					],
				};
			}

			const lines = snapshots.map(
				(s) =>
					`${s.entryId}: ${s.files.length} files at ${s.timestamp}`,
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `File history (${snapshots.length} snapshots):\n${lines.join("\n")}`,
					},
				],
			};
		},
	});
}
