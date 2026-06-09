/**
 * Aery Extension — Advanced tools integrated into core
 *
 * - LSP Tool: IDE-level code intelligence (9 operations)
 * - MCP Client: Model Context Protocol (dynamic tool discovery)
 * - Monitor Tool: Background process watching with stdout streaming
 * - Notebook Edit Tool: Jupyter notebook cell editing
 * - Cron Scheduler: Recurring/one-shot task scheduling
 * - Skill Tool: Execute skills with model override
 * - Ask User Question: Interactive multiple-choice questions
 * - Tool Search: Discover tools by keyword
 * - Task v2: Task management with dependencies
 * - Agent Teams: TeamCreate, team task queue, inbox messaging
 * - Memory Behaviors: User/project/team memory guidance and SaveMemory
 * - Workflow Behaviors: Continuous work, background agents, planning, verification
 * - MCP Resources: List/read MCP server resources
 * - Code Search: Ripgrep-based multi-query code search
 * - String Replace: Targeted surgical file editing with validation
 * - File Picker: Fuzzy semantic file finding with scoring
 * - Browser Enhanced: Multi-step browser automation with console capture
 * - Context Prune: Session context summarization and checkpointing
 * - Todo Tracker: Ordered step-by-step plan tracking with completion status
 * - Code Reviewer: Review changes for bugs, security issues, and correctness
 * - Web Researcher: Multi-source web research and synthesis
 */

import type { ExtensionAPI } from "@aryee337/aery";
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
import agentTeams from "./agent-teams.js";
import memoryBehaviors from "./memory-behaviors.js";
import workflowBehaviors from "./workflow-behaviors.js";
import planModeTools from "./plan-mode-tools.js";
import { registerMcpResourceTools } from "./mcp-resources.js";
import { registerCodeSearchTool } from "./code-search.js";
import { registerStrReplaceTool } from "./str-replace.js";
import { registerFilePickerTool } from "./file-picker.js";
import { registerBrowserEnhancedTools } from "./browser-enhanced.js";
import { registerContextPruneTool } from "./context-prune.js";
import { registerTodoTrackerTool } from "./todo-tracker.js";
import { registerCodeReviewerTool } from "./code-reviewer.js";
import { registerWebResearcherTool } from "./web-researcher.js";

export default function aeryExtension(aery: ExtensionAPI): void {
	// ─── LSP (Language Server Protocol) ──────────────────────────────────
	const lspManager = createLspManager();
	registerLspTool(aery, lspManager);

	// ─── MCP (Model Context Protocol) ───────────────────────────────────
	const mcpConfigs = loadMcpConfig();
	const mcpManager = createMcpClientManager(mcpConfigs);
	registerMcpTools(aery, mcpManager);

	// ─── Monitor ─────────────────────────────────────────────────────────
	registerMonitorTool(aery);

	// ─── Notebook ────────────────────────────────────────────────────────
	registerNotebookEditTool(aery);

	// ─── Skill ───────────────────────────────────────────────────────────
	registerSkillTool(aery);

	// ─── Ask User Question ───────────────────────────────────────────────
	registerAskUserQuestionTool(aery);

	// ─── Tool Search ─────────────────────────────────────────────────────
	registerToolSearchTool(aery);

	// ─── Task v2 ─────────────────────────────────────────────────────────
	registerTaskTools(aery);

	// ─── Agent Teams ─────────────────────────────────────────────────────
	agentTeams(aery);

	// ─── Memory Behaviors ───────────────────────────────────────────────
	memoryBehaviors(aery);

	// ─── Workflow Behaviors ──────────────────────────────────────────────
	workflowBehaviors(aery);

	// ─── Plan Mode ────────────────────────────────────────────────────────
	planModeTools(aery);

	// ─── MCP Resources ───────────────────────────────────────────────────
	registerMcpResourceTools(aery, mcpManager);

	// ─── Cron Scheduler ──────────────────────────────────────────────────
	const cronScheduler = createCronScheduler((msg) =>
		aery.sendUserMessage(msg),
	);
	registerCronCreateTool(aery, cronScheduler);
	registerCronDeleteTool(aery, cronScheduler);
	registerCronListTool(aery, cronScheduler);

	// ─── Code Search ─────────────────────────────────────────────────────
	registerCodeSearchTool(aery);

	// ─── String Replace ──────────────────────────────────────────────────
	registerStrReplaceTool(aery);

	// ─── File Picker ─────────────────────────────────────────────────────
	registerFilePickerTool(aery);

	// ─── Browser Enhanced ────────────────────────────────────────────────
	registerBrowserEnhancedTools(aery);

	// ─── Context Prune ───────────────────────────────────────────────────
	registerContextPruneTool(aery);

	// ─── Todo Tracker ────────────────────────────────────────────────────
	registerTodoTrackerTool(aery);

	// ─── Code Reviewer ───────────────────────────────────────────────────
	registerCodeReviewerTool(aery);

	// ─── Web Researcher ──────────────────────────────────────────────────
	registerWebResearcherTool(aery);

	// ─── Lifecycle ───────────────────────────────────────────────────────
	aery.on("session_start", async () => {
		lspManager.initialize();
		cronScheduler.start();

		// Connect MCP servers in background (non-blocking)
		mcpManager.connectAll().catch(() => {});
	});

	aery.on("session_shutdown", () => {
		lspManager.shutdown();
		mcpManager.disconnectAll();
		cronScheduler.stop();
	});
}
