/**
 * Aery Extension Pack
 *
 * Advanced tools for Aery:
 * - LSP Tool: IDE-level code intelligence (9 operations)
 * - MCP Client: Model Context Protocol (dynamic tool discovery)
 * - Monitor Tool: Background process watching with stdout streaming
 * - Notebook Edit Tool: Jupyter notebook cell editing
 * - Cron Scheduler: Recurring/one-shot task scheduling
 * - Skill Tool: Execute skills with model override
 * - Ask User Question: Interactive multiple-choice questions
 * - Tool Search: Discover tools by keyword
 * - Task v2: Task management with dependencies
 * - MCP Resources: List/read MCP server resources
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { createLspManager } from "./lsp-manager.js";
import { registerLspTool } from "./lsp-tool.js";
import { createMcpClientManager } from "./mcp-client.js";
import { registerMcpTools } from "./mcp-tool.js";
import { loadMcpConfig } from "./mcp-config.js";
import { registerMonitorTool } from "./monitor-tool.js";
import { registerNotebookEditTool } from "./notebook-edit-tool.js";
import { createCronScheduler } from "./cron-scheduler.js";
import { registerCronCreateTool } from "./cron-create-tool.js";
import { registerCronDeleteTool } from "./cron-delete-tool.js";
import { registerCronListTool } from "./cron-list-tool.js";
import { registerSkillTool } from "./skill-tool.js";
import { registerAskUserQuestionTool } from "./ask-user-question-tool.js";
import { registerToolSearchTool } from "./tool-search-tool.js";
import { registerTaskTools } from "./task-v2.js";
import { registerMcpResourceTools } from "./mcp-resources.js";

export default function aeryExtension(pi: ExtensionAPI): void {
	// ─── LSP (Language Server Protocol) ──────────────────────────────────
	const lspManager = createLspManager();
	registerLspTool(pi, lspManager);

	// ─── MCP (Model Context Protocol) ───────────────────────────────────
	const mcpConfigs = loadMcpConfig();
	const mcpManager = createMcpClientManager(mcpConfigs);
	registerMcpTools(pi, mcpManager);

	// ─── Monitor ─────────────────────────────────────────────────────────
	registerMonitorTool(pi);

	// ─── Notebook ────────────────────────────────────────────────────────
	registerNotebookEditTool(pi);

	// ─── Skill ───────────────────────────────────────────────────────────
	registerSkillTool(pi);

	// ─── Ask User Question ───────────────────────────────────────────────
	registerAskUserQuestionTool(pi);

	// ─── Tool Search ─────────────────────────────────────────────────────
	registerToolSearchTool(pi);

	// ─── Task v2 ─────────────────────────────────────────────────────────
	registerTaskTools(pi);

	// ─── MCP Resources ───────────────────────────────────────────────────
	registerMcpResourceTools(pi, mcpManager);

	// ─── Cron Scheduler ──────────────────────────────────────────────────
	const cronScheduler = createCronScheduler((msg) =>
		pi.sendUserMessage(msg),
	);
	registerCronCreateTool(pi, cronScheduler);
	registerCronDeleteTool(pi, cronScheduler);
	registerCronListTool(pi, cronScheduler);

	// ─── Lifecycle ───────────────────────────────────────────────────────
	pi.on("session_start", async () => {
		lspManager.initialize();
		cronScheduler.start();

		// Connect MCP servers in background (non-blocking)
		mcpManager.connectAll().catch(() => {});
	});

	pi.on("session_shutdown", () => {
		lspManager.shutdown();
		mcpManager.disconnectAll();
		cronScheduler.stop();
	});
}
