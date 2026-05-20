/**
 * MCP Tool Registration
 * On session_start, discovers MCP tools and registers them as Aery tools.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";
import type { McpClientManager, McpToolDef } from "./types.js";

export function registerMcpTools(
	pi: ExtensionAPI,
	mcpManager: McpClientManager,
): void {
	// Register a meta-tool that lists available MCP tools
	pi.registerTool({
		name: "mcp_list",
		description:
			"List all available MCP (Model Context Protocol) tools from connected servers.",
		parameters: Type.Object({}),
		async execute() {
			const tools = mcpManager.getAllTools();
			if (tools.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No MCP servers connected. Configure servers in .mcp.json or ~/.aery/agent/mcp.json.",
						},
					],
				};
			}

			const grouped = new Map<string, McpToolDef[]>();
			for (const tool of tools) {
				const existing = grouped.get(tool.serverName);
				if (existing) {
					existing.push(tool);
				} else {
					grouped.set(tool.serverName, [tool]);
				}
			}

			const lines: string[] = [];
			for (const [server, serverTools] of grouped) {
				lines.push(`\n**${server}** (${serverTools.length} tools):`);
				for (const tool of serverTools) {
					lines.push(
						`  - mcp__${server}__${tool.name}: ${tool.description.slice(0, 100)}`,
					);
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `MCP Tools:${lines.join("\n")}`,
					},
				],
			};
		},
	});

	// Register each discovered MCP tool dynamically
	// This happens after session_start when tools are discovered
	pi.on("session_start", async () => {
		const tools = mcpManager.getAllTools();

		for (const tool of tools) {
			const toolName = `mcp__${tool.serverName}__${tool.name}`;

			// Skip if already registered
			try {
				pi.registerTool({
					name: toolName,
					description: `[MCP:${tool.serverName}] ${tool.description}`,
					promptSnippet: `MCP tool from ${tool.serverName}`,
					// Use passthrough schema since MCP tools define their own
					parameters: Type.Object(
						{},
						{ additionalProperties: true },
					),
					async execute(_id, params) {
						const result = await mcpManager.callTool(
							tool.serverName,
							tool.name,
							params as Record<string, unknown>,
						);

						return {
							content: [
								{
									type: "text" as const,
									text: result.content,
								},
							],
							isError: result.isError,
						};
					},
				});
			} catch {
				// Tool name conflict — skip
			}
		}
	});
}
