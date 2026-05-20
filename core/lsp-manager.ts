/**
 * LSP Server Manager
 * Manages multiple language server instances, routes requests by file extension.
 */

import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLspConfig, getServerForExtension } from "./lsp-config.js";
import { createLspClient, type LspClient } from "./lsp-client.js";
import type {
	LspServersConfig,
	TextDocumentItem,
	Position,
} from "./types.js";

interface ServerInstance {
	client: LspClient;
	name: string;
	openFiles: Set<string>;
}

export interface LspManager {
	initialize(): Promise<void>;
	shutdown(): void;
	isReady(): boolean;
	sendRequest(
		filePath: string,
		method: string,
		params: unknown,
	): Promise<unknown>;
	openFile(filePath: string, content: string): Promise<void>;
	closeFile(filePath: string): void;
	isFileOpen(filePath: string): boolean;
}

export function createLspManager(): LspManager {
	const config: LspServersConfig = loadLspConfig();
	const servers = new Map<string, ServerInstance>();
	let ready = false;

	async function ensureServer(
		filePath: string,
	): Promise<ServerInstance | undefined> {
		const ext = extname(filePath);
		const match = getServerForExtension(config, ext);
		if (!match) return undefined;

		if (servers.has(match.name)) {
			return servers.get(match.name)!;
		}

		// Start the server
		const client = createLspClient(match.name, match.config);
		const instance: ServerInstance = {
			client,
			name: match.name,
			openFiles: new Set(),
		};

		try {
			await client.start();
			const rootUri = pathToFileURL(process.cwd()).href;
			await client.initialize(rootUri);
			servers.set(match.name, instance);
			return instance;
		} catch {
			// Server failed to start (not installed, etc.)
			return undefined;
		}
	}

	return {
		async initialize(): Promise<void> {
			// Pre-start servers for common file types
			ready = true;
		},

		shutdown(): void {
			for (const server of servers.values()) {
				server.client.stop();
			}
			servers.clear();
			ready = false;
		},

		isReady(): boolean {
			return ready;
		},

		async sendRequest(
			filePath: string,
			method: string,
			params: unknown,
		): Promise<unknown> {
			const server = await ensureServer(filePath);
			if (!server) return undefined;
			return server.client.sendRequest(method, params);
		},

		async openFile(
			filePath: string,
			content: string,
		): Promise<void> {
			const server = await ensureServer(filePath);
			if (!server) return;

			const fileUri = pathToFileURL(filePath).href;
			if (server.openFiles.has(fileUri)) return;

			const doc: TextDocumentItem = {
				uri: fileUri,
				languageId: guessLanguageId(filePath),
				version: 1,
				text: content,
			};
			server.client.sendNotification("textDocument/didOpen", {
				textDocument: doc,
			});
			server.openFiles.add(fileUri);
		},

		closeFile(filePath: string): void {
			const ext = extname(filePath);
			const match = getServerForExtension(config, ext);
			if (!match) return;

			const server = servers.get(match.name);
			if (!server) return;

			const fileUri = pathToFileURL(filePath).href;
			if (!server.openFiles.has(fileUri)) return;

			server.client.sendNotification("textDocument/didClose", {
				textDocument: { uri: fileUri },
			});
			server.openFiles.delete(fileUri);
		},

		isFileOpen(filePath: string): boolean {
			const ext = extname(filePath);
			const match = getServerForExtension(config, ext);
			if (!match) return false;

			const server = servers.get(match.name);
			if (!server) return false;

			const fileUri = pathToFileURL(filePath).href;
			return server.openFiles.has(fileUri);
		},
	};
}

function guessLanguageId(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	const map: Record<string, string> = {
		".ts": "typescript",
		".tsx": "typescriptreact",
		".js": "javascript",
		".jsx": "javascriptreact",
		".mjs": "javascript",
		".cjs": "javascript",
		".py": "python",
		".pyi": "python",
		".rs": "rust",
		".go": "go",
		".json": "json",
		".md": "markdown",
		".yaml": "yaml",
		".yml": "yaml",
		".toml": "toml",
		".html": "html",
		".css": "css",
		".scss": "scss",
		".sh": "shellscript",
		".bash": "shellscript",
	};
	return map[ext] ?? "plaintext";
}
