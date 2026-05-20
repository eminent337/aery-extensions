/**
 * MCP Client — connects to MCP servers, discovers tools, executes calls.
 * Supports stdio and http transports.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { McpServerConfig, McpToolDef } from "./types.js";

interface McpConnection {
	name: string;
	config: McpServerConfig;
	process?: ChildProcess;
	tools: McpToolDef[];
	connected: boolean;
	requestId: number;
	pending: Map<
		number,
		{ resolve: (r: any) => void; reject: (e: Error) => void }
	>;
	buffer: string;
}

export interface McpClientManager {
	connectAll(): Promise<void>;
	disconnectAll(): void;
	getAllTools(): McpToolDef[];
	callTool(
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<{ content: string; isError: boolean }>;
}

function createStdioConnection(
	name: string,
	config: McpServerConfig,
): McpConnection {
	return {
		name,
		config,
		tools: [],
		connected: false,
		requestId: 0,
		pending: new Map(),
		buffer: "",
	};
}

function sendJsonRpc(conn: McpConnection, message: object): void {
	if (!conn.process?.stdin) {
		throw new Error(`MCP server ${conn.name} not connected`);
	}
	const content = JSON.stringify(message);
	const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
	conn.process.stdin.write(header + content);
}

function handleStdioData(conn: McpConnection, chunk: Buffer): void {
	conn.buffer += chunk.toString();

	while (true) {
		const headerEnd = conn.buffer.indexOf("\r\n\r\n");
		if (headerEnd === -1) break;

		const header = conn.buffer.slice(0, headerEnd);
		const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
		if (!lengthMatch) {
			conn.buffer = conn.buffer.slice(headerEnd + 4);
			continue;
		}

		const length = parseInt(lengthMatch[1], 10);
		const messageStart = headerEnd + 4;
		if (conn.buffer.length < messageStart + length) break;

		const body = conn.buffer.slice(messageStart, messageStart + length);
		conn.buffer = conn.buffer.slice(messageStart + length);

		try {
			const message = JSON.parse(body);
			if (
				message.id !== undefined &&
				conn.pending.has(message.id)
			) {
				const req = conn.pending.get(message.id)!;
				conn.pending.delete(message.id);
				if (message.error) {
					req.reject(
						new Error(
							message.error.message || "MCP error",
						),
					);
				} else {
					req.resolve(message.result);
				}
			}
		} catch {
			// Ignore malformed messages
		}
	}
}

function requestStdio(
	conn: McpConnection,
	method: string,
	params?: unknown,
): Promise<any> {
	return new Promise((resolve, reject) => {
		const id = ++conn.requestId;
		conn.pending.set(id, { resolve, reject });
		sendJsonRpc(conn, { jsonrpc: "2.0", id, method, params });

		// Timeout after 30 seconds
		setTimeout(() => {
			if (conn.pending.has(id)) {
				conn.pending.delete(id);
				reject(new Error(`MCP request ${method} timed out`));
			}
		}, 30_000);
	});
}

async function connectStdio(
	conn: McpConnection,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(conn.config.command!, conn.config.args ?? [], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...conn.config.env },
			shell: false,
		});

		child.on("error", (err) => {
			if (!conn.connected) {
				reject(
					new Error(
						`Failed to start MCP server ${conn.name}: ${err.message}`,
					),
				);
			}
		});

		child.on("exit", () => {
			conn.connected = false;
		});

		child.stdout?.on("data", (data: Buffer) => {
			handleStdioData(conn, data);
		});

		conn.process = child;
		conn.connected = true;
		resolve();
	});
}

async function discoverTools(conn: McpConnection): Promise<McpToolDef[]> {
	try {
		const result = await requestStdio(conn, "tools/list");
		if (!result?.tools || !Array.isArray(result.tools)) return [];

		return result.tools.map((tool: any) => ({
			name: tool.name,
			serverName: conn.name,
			description: tool.description ?? "",
			inputSchema: tool.inputSchema ?? { type: "object" },
		}));
	} catch {
		return [];
	}
}

export function createMcpClientManager(
	configs: Record<string, McpServerConfig>,
): McpClientManager {
	const connections = new Map<string, McpConnection>();

	return {
		async connectAll(): Promise<void> {
			const promises = Object.entries(configs).map(
				async ([name, config]) => {
					if (config.type === "http" || config.type === "sse") {
						// HTTP/SSE transport — not yet implemented
						return;
					}

					if (!config.command) return;

					const conn = createStdioConnection(name, config);
					try {
						await connectStdio(conn);

						// Initialize
						await requestStdio(conn, "initialize", {
							protocolVersion: "2024-11-05",
							capabilities: {},
							clientInfo: {
								name: "aery",
								version: "1.0.0",
							},
						});

						// Discover tools
						conn.tools = await discoverTools(conn);
						connections.set(name, conn);
					} catch {
						// Server failed to start — skip
					}
				},
			);

			await Promise.allSettled(promises);
		},

		disconnectAll(): void {
			for (const conn of connections.values()) {
				if (conn.process) {
					try {
						sendJsonRpc(conn, {
							jsonrpc: "2.0",
							method: "shutdown",
						});
						conn.process.kill();
					} catch {
						// Best effort
					}
				}
			}
			connections.clear();
		},

		getAllTools(): McpToolDef[] {
			const tools: McpToolDef[] = [];
			for (const conn of connections.values()) {
				tools.push(...conn.tools);
			}
			return tools;
		},

		async callTool(
			serverName: string,
			toolName: string,
			args: Record<string, unknown>,
		): Promise<{ content: string; isError: boolean }> {
			const conn = connections.get(serverName);
			if (!conn) {
				return {
					content: `MCP server ${serverName} not connected`,
					isError: true,
				};
			}

			try {
				const result = await requestStdio(conn, "tools/call", {
					name: toolName,
					arguments: args,
				});

				if (result?.isError) {
					const text =
						result.content?.[0]?.text ?? "Unknown error";
					return { content: text, isError: true };
				}

				// Extract text from content blocks
				if (Array.isArray(result?.content)) {
					const text = result.content
						.map((c: any) => c.text ?? "")
						.filter(Boolean)
						.join("\n");
					return { content: text, isError: false };
				}

				return {
					content: typeof result === "string" ? result : JSON.stringify(result),
					isError: false,
				};
			} catch (e) {
				return {
					content: `MCP tool call failed: ${(e as Error).message}`,
					isError: true,
				};
			}
		},
	};
}
