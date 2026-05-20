/**
 * LSP Server Configuration
 * Loads from ~/.aery/agent/lsp-servers.json with defaults for common languages.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LspServersConfig, LspServerConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".aery", "agent");
const CONFIG_FILE = join(CONFIG_DIR, "lsp-servers.json");

const DEFAULT_CONFIG: LspServersConfig = {
	servers: {
		typescript: {
			command: "typescript-language-server",
			args: ["--stdio"],
			fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		},
		python: {
			command: "pyright-langserver",
			args: ["--stdio"],
			fileExtensions: [".py", ".pyi"],
		},
		rust: {
			command: "rust-analyzer",
			args: [],
			fileExtensions: [".rs"],
		},
		go: {
			command: "gopls",
			args: [],
			fileExtensions: [".go"],
		},
	},
};

export function loadLspConfig(): LspServersConfig {
	try {
		if (existsSync(CONFIG_FILE)) {
			const raw = readFileSync(CONFIG_FILE, "utf-8");
			const config = JSON.parse(raw) as LspServersConfig;
			if (config.servers && typeof config.servers === "object") {
				return config;
			}
		}
	} catch {
		// Fall through to defaults
	}

	// Write defaults if config doesn't exist
	try {
		if (!existsSync(CONFIG_DIR)) {
			mkdirSync(CONFIG_DIR, { recursive: true });
		}
		if (!existsSync(CONFIG_FILE)) {
			writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
		}
	} catch {
		// Best effort
	}

	return DEFAULT_CONFIG;
}

export function getServerForExtension(
	config: LspServersConfig,
	ext: string,
): { name: string; config: LspServerConfig } | undefined {
	for (const [name, serverConfig] of Object.entries(config.servers)) {
		if (serverConfig.fileExtensions.includes(ext)) {
			return { name, config: serverConfig };
		}
	}
	return undefined;
}
