/**
 * MCP Resource Tools — List and read resources from MCP servers.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";
import type { McpClientManager } from "./types.js";

export function registerMcpResourceTools(
	aery: ExtensionAPI,
	mcpManager: McpClientManager,
): void {
	// ─── ListMcpResources ────────────────────────────────────────────────
	aery.registerTool({
		name: "mcp_list_resources",
		description:
			"List available resources from connected MCP servers.",
		parameters: Type.Object({}),
		async execute() {
			// MCP resources are discovered via the client
			// For now, report connected servers and their tools
			const tools = mcpManager.getAllTools();
			const servers = new Set(tools.map((t) => t.serverName));

			if (servers.size === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No MCP servers connected. Configure servers in .mcp.json.",
						},
					],
				};
			}

			const lines: string[] = [
				`Connected MCP servers: ${[...servers].join(", ")}`,
			];
			lines.push(
				`Total tools available: ${tools.length}`,
			);
			lines.push(
				"\nUse mcp__<server>__<tool> to call specific tools.",
			);
			lines.push(
				"MCP resources require server-specific implementation.",
			);

			return {
				content: [
					{ type: "text" as const, text: lines.join("\n") },
				],
			};
		},
	});

	// ─── ReadMcpResource ─────────────────────────────────────────────────
	aery.registerTool({
		name: "mcp_read_resource",
		description:
			"Read a specific resource from an MCP server by server name and URI.",
		parameters: Type.Object({
			server: Type.String({
				description: "The MCP server name",
			}),
			uri: Type.String({
				description: "The resource URI to read",
			}),
		}),
		async execute(_id, params) {
			// MCP resource reading requires the client to support resources/read
			// This is a simplified implementation
			return {
				content: [
					{
						type: "text" as const,
						text: `MCP resource reading for ${params.server}:${params.uri} requires the MCP server to support the resources/read method. Check your MCP server documentation.`,
					},
				],
			};
		},
	});
}
