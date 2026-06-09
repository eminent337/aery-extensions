/**
 * LSP Client — stdio-based Language Server Protocol client
 * Spawns language servers and communicates via JSON-RPC over stdin/stdout.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { LspServerConfig, Position, TextDocumentItem } from "./types.js";

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
}

export interface LspClient {
	start(): Promise<void>;
	initialize(rootUri: string): Promise<void>;
	sendRequest(method: string, params: unknown): Promise<unknown>;
	sendNotification(method: string, params: unknown): void;
	stop(): void;
	isRunning(): boolean;
}

export function createLspClient(
	name: string,
	config: LspServerConfig,
): LspClient {
	let process: ChildProcess | undefined;
	let requestId = 0;
	const pending = new Map<number, PendingRequest>();
	let initialized = false;
	let buffer = "";

	function send(jsonrpcMessage: object): void {
		if (!process?.stdin) {
			throw new Error(`LSP server ${name} not running`);
		}
		const content = JSON.stringify(jsonrpcMessage);
		const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
		process.stdin.write(message);
	}

	function handleData(chunk: Buffer): void {
		buffer += chunk.toString();

		while (true) {
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) break;

			const header = buffer.slice(0, headerEnd);
			const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
			if (!lengthMatch) {
				buffer = buffer.slice(headerEnd + 4);
				continue;
			}

			const length = parseInt(lengthMatch[1], 10);
			const messageStart = headerEnd + 4;
			if (buffer.length < messageStart + length) break;

			const body = buffer.slice(messageStart, messageStart + length);
			buffer = buffer.slice(messageStart + length);

			try {
				const message = JSON.parse(body);
				handleMessage(message);
			} catch {
				// Ignore malformed messages
			}
		}
	}

	function handleMessage(message: any): void {
		if (message.id !== undefined && pending.has(message.id)) {
			const req = pending.get(message.id)!;
			pending.delete(message.id);
			if (message.error) {
				req.reject(new Error(message.error.message || "LSP error"));
			} else {
				req.resolve(message.result);
			}
		}
		// Notifications from server are ignored for now
	}

	return {
		async start(): Promise<void> {
			return new Promise((resolve, reject) => {
				const env = { ...process.env, ...config.env };
				const child = spawn(config.command, config.args, {
					stdio: ["pipe", "pipe", "pipe"],
					env,
					shell: false,
				});

				child.on("error", (err) => {
					if (!initialized) {
						reject(
							new Error(
								`Failed to start LSP server ${name}: ${err.message}`,
							),
						);
					}
				});

				child.on("exit", () => {
					process = undefined;
				});

				child.stdout?.on("data", handleData);

				// stderr is silently consumed (LSP servers log to stderr)

				process = child;
				resolve();
			});
		},

		async initialize(rootUri: string): Promise<void> {
			const result = await this.sendRequest("initialize", {
				processId: process?.pid ?? null,
				capabilities: {
					textDocument: {
						synchronization: { didOpen: true, didClose: true },
						definition: { dynamicRegistration: false },
						references: { dynamicRegistration: false },
						hover: { dynamicRegistration: false },
						documentSymbol: { dynamicRegistration: false },
						implementation: { dynamicRegistration: false },
						callHierarchy: { dynamicRegistration: false },
					},
					workspace: {
						symbol: { dynamicRegistration: false },
					},
				},
				rootUri,
			});
			this.sendNotification("initialized", {});
			initialized = true;
			return result as void;
		},

		async sendRequest(
			method: string,
			params: unknown,
		): Promise<unknown> {
			if (!process) {
				throw new Error(`LSP server ${name} not running`);
			}
			return new Promise((resolve, reject) => {
				const id = ++requestId;
				pending.set(id, { resolve, reject });
				send({ jsonrpc: "2.0", id, method, params });

				// Timeout after 30 seconds
				setTimeout(() => {
					if (pending.has(id)) {
						pending.delete(id);
						reject(new Error(`LSP request ${method} timed out`));
					}
				}, 30_000);
			});
		},

		sendNotification(method: string, params: unknown): void {
			send({ jsonrpc: "2.0", method, params });
		},

		stop(): void {
			if (process) {
				this.sendNotification("shutdown", undefined);
				process.kill();
				process = undefined;
			}
		},

		isRunning(): boolean {
			return process !== undefined;
		},
	};
}
