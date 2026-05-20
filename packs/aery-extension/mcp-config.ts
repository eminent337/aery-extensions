/**
 * MCP Configuration
 * Reads .mcp.json from cwd (walk up to root) and ~/.aery/agent/mcp.json
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { McpServerConfig, McpConfig } from "./types.js";

const GLOBAL_CONFIG = join(homedir(), ".aery", "agent", "mcp.json");

function expandEnvVars(str: string): string {
	return str.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
}

function expandConfig(obj: any): any {
	if (typeof obj === "string") return expandEnvVars(obj);
	if (Array.isArray(obj)) return obj.map(expandConfig);
	if (obj && typeof obj === "object") {
		const result: any = {};
		for (const [k, v] of Object.entries(obj)) {
			result[k] = expandConfig(v);
		}
		return result;
	}
	return obj;
}

function readMcpFile(filePath: string): Record<string, McpServerConfig> {
	try {
		if (!existsSync(filePath)) return {};
		const raw = readFileSync(filePath, "utf-8");
		const config = expandConfig(JSON.parse(raw)) as McpConfig;
		if (config.mcpServers && typeof config.mcpServers === "object") {
			return config.mcpServers;
		}
	} catch {
		// Ignore malformed files
	}
	return {};
}

export function loadMcpConfig(): Record<string, McpServerConfig> {
	const servers: Record<string, McpServerConfig> = {};

	// Walk up from cwd to root looking for .mcp.json
	let dir = process.cwd();
	const root = dirname(dir);
	while (true) {
		const mcpFile = join(dir, ".mcp.json");
		const found = readMcpFile(mcpFile);
		// Merge (closer files take precedence)
		for (const [name, config] of Object.entries(found)) {
			if (!servers[name]) {
				servers[name] = config;
			}
		}
		if (dir === root) break;
		dir = dirname(dir);
	}

	// Global config (lower precedence)
	const global = readMcpFile(GLOBAL_CONFIG);
	for (const [name, config] of Object.entries(global)) {
		if (!servers[name]) {
			servers[name] = config;
		}
	}

	return servers;
}
