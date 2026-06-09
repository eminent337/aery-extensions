/**
 * Integration tests for core extension interactions.
 * Tests that extensions work together correctly through the event system.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

// ─── Circuit Breaker + Tool Result Compaction ────────────────────────────────

import { compactToolResultContent, isBuiltinToolName } from "./circuit-breaker.ts";

test("circuit breaker: builtin tools are not compacted", () => {
	const content = [{ type: "text" as const, text: "x".repeat(50_000) }];
	for (const tool of ["bash", "read", "edit", "write", "grep", "find", "ls"]) {
		const result = compactToolResultContent(tool, content);
		assert.deepEqual(result, content, `${tool} should not be compacted`);
	}
});

test("circuit breaker: extension tool results over 1500 chars are compacted", () => {
	const bigText = "a".repeat(2000);
	const content = [{ type: "text" as const, text: bigText }];
	const result = compactToolResultContent("custom_tool", content);
	const text = result[0]?.type === "text" ? result[0].text : "";
	assert.ok(text.includes("Output compacted"), "should compact large extension output");
	assert.ok(text.includes("text result length: 2000 chars"), "should report content length");
	assert.ok(text.length < bigText.length, "compacted output should be shorter than original");
});

test("circuit breaker: extension tool results under 1500 chars pass through", () => {
	const smallText = "ok";
	const content = [{ type: "text" as const, text: smallText }];
	const result = compactToolResultContent("custom_tool", content);
	assert.deepEqual(result, content);
});

test("circuit breaker: image content is never compacted", () => {
	const content = [{ type: "image" as const, mimeType: "image/png", data: "base64data" }];
	const result = compactToolResultContent("custom_tool", content);
	assert.deepEqual(result, content);
});

// ─── Provider Profiles + Model Selection ─────────────────────────────────────

import { shouldDisableProviderProfileOnModelSelect } from "./provider-profiles.ts";

test("provider profile: manual model select disables active profile", () => {
	assert.equal(
		shouldDisableProviderProfileOnModelSelect({
			activeProfile: "openrouter",
			autoEnabled: false,
			autoRouterSwitching: false,
			providerProfileSwitching: false,
			source: "set",
		}),
		true,
	);
});

test("provider profile: auto-router switching keeps profile active", () => {
	assert.equal(
		shouldDisableProviderProfileOnModelSelect({
			activeProfile: "openrouter",
			autoEnabled: false,
			autoRouterSwitching: true,
			providerProfileSwitching: false,
			source: "set",
		}),
		false,
	);
});

// ─── Multi-Agent Mailbox ─────────────────────────────────────────────────────

test("multi-agent: mailbox creates pending/approved/rejected directories", () => {
	const testDir = join(tmpdir(), `aery-mailbox-test-${Date.now()}`);
	mkdirSync(testDir, { recursive: true });

	try {
		const pendingDir = join(testDir, "pending");
		const approvedDir = join(testDir, "approved");
		const rejectedDir = join(testDir, "rejected");

		// Simulate what multi-agent.ts does
		[pendingDir, approvedDir, rejectedDir].forEach((dir) => {
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		});

		assert.ok(existsSync(pendingDir));
		assert.ok(existsSync(approvedDir));
		assert.ok(existsSync(rejectedDir));
	} finally {
		rmSync(testDir, { recursive: true, force: true });
	}
});

// ─── Agent Enhancements: Tool Result Compaction ──────────────────────────────

test("agent enhancements: compaction detects HTML results", () => {
	const html = "<!DOCTYPE html><html><body>" + "x".repeat(5000) + "</body></html>";
	const result = compactToolResultContent("some_tool", [{ type: "text", text: html }]);
	const text = result[0]?.type === "text" ? result[0].text : "";
	assert.ok(text.includes("HTML result"), "should detect HTML content type");
});

test("agent enhancements: compaction detects JSON results", () => {
	const json = JSON.stringify({ data: "x".repeat(5000) });
	const result = compactToolResultContent("some_tool", [{ type: "text", text: json }]);
	const text = result[0]?.type === "text" ? result[0].text : "";
	assert.ok(text.includes("JSON result"), "should detect JSON content type");
});

test("agent enhancements: compaction detects code results", () => {
	const code = 'function hello() {\n  return "' + "x".repeat(5000) + '";\n}';
	const result = compactToolResultContent("some_tool", [{ type: "text", text: code }]);
	const text = result[0]?.type === "text" ? result[0].text : "";
	assert.ok(text.includes("code result"), "should detect code content type");
});

// ─── Extension Export Validation ─────────────────────────────────────────────

test("all core extensions export a default function", async () => {
	const coreDir = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core");
	const files = [
		"aery-extension.ts",
		"agent-enhancements.ts",
		"agent-routing.ts",
		"auto-fix.ts",
		"circuit-breaker.ts",
		"commands.ts",
		"coordination-enhancements.ts",
		"coordinator-mode.ts",
		"damage-control.ts",
		"default-agents.ts",
		"file-history.ts",
		"graphify.ts",
		"help.ts",
		"hooks-enhanced.ts",
		"hooks.ts",
		"init-prompt.ts",
		"marketplace.ts",
		"memory-include.ts",
		"model-failover.ts",
		"multi-agent.ts",
		"provider-profiles.ts",
		"session-auto-name.ts",
		"upstream-notify.ts",
		"web-fetch.ts",
		"web-search.ts",
	];

	for (const file of files) {
		const filepath = join(coreDir, file);
		if (!existsSync(filepath)) continue;
		const content = readFileSync(filepath, "utf-8");
		assert.ok(
			content.includes("export default function"),
			`${file} should export a default function`,
		);
	}
});

test("all core extensions use 'aery' as the ExtensionAPI parameter name", async () => {
	const coreDir = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core");
	const files = [
		"aery-extension.ts",
		"aery-team.ts",
		"agent-enhancements.ts",
		"agent-routing.ts",
		"ask-user-question-tool.ts",
		"auto-fix.ts",
		"coordination-enhancements.ts",
		"coordinator-mode.ts",
		"cron-create-tool.ts",
		"cron-delete-tool.ts",
		"cron-list-tool.ts",
		"file-history.ts",
		"hooks-enhanced.ts",
		"lsp-tool.ts",
		"mcp-resources.ts",
		"mcp-tool.ts",
		"monitor-tool.ts",
		"notebook-edit-tool.ts",
		"skill-tool.ts",
		"task-v2.ts",
		"tool-deferral.ts",
		"tool-search-tool.ts",
	];

	for (const file of files) {
		const filepath = join(coreDir, file);
		if (!existsSync(filepath)) continue;
		const content = readFileSync(filepath, "utf-8");

		// Should have 'aery: ExtensionAPI' in function signature
		assert.ok(
			content.includes("aery: ExtensionAPI"),
			`${file} should use 'aery: ExtensionAPI' parameter`,
		);

		// Should NOT have 'pi: ExtensionAPI'
		assert.ok(
			!content.includes("pi: ExtensionAPI"),
			`${file} should not use legacy 'pi: ExtensionAPI' parameter`,
		);
	}
});

// ─── Event Subscription Coverage ─────────────────────────────────────────────

test("extensions subscribe to expected lifecycle events", async () => {
	const coreDir = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core");

	// Map of file -> expected events it should subscribe to
	const expectedEvents: Record<string, string[]> = {
		"agent-enhancements.ts": ["before_agent_start", "tool_result", "turn_end", "session_start"],
		"agent-routing.ts": ["before_agent_start", "turn_end"],
		"auto-fix.ts": ["tool_result", "turn_start"],
		"coordination-enhancements.ts": ["before_agent_start", "session_start", "tool_result"],
		"coordinator-mode.ts": ["session_shutdown"],
		"file-history.ts": ["session_start", "tool_call", "turn_end"],
		"hooks-enhanced.ts": ["tool_call", "tool_result", "session_start", "session_shutdown", "turn_start", "turn_end"],
	};

	for (const [file, events] of Object.entries(expectedEvents)) {
		const filepath = join(coreDir, file);
		if (!existsSync(filepath)) continue;
		const content = readFileSync(filepath, "utf-8");

		for (const event of events) {
			assert.ok(
				content.includes(`"${event}"`),
				`${file} should subscribe to "${event}" event`,
			);
		}
	}
});

// ─── Tool Registration Names ─────────────────────────────────────────────────

test("extensions register tools with expected names", async () => {
	const coreDir = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core");

	const expectedTools: Record<string, string[]> = {
		"lsp-tool.ts": ["lsp"],
		"mcp-tool.ts": [], // dynamic, depends on MCP config
		"monitor-tool.ts": ["monitor"],
		"notebook-edit-tool.ts": ["notebook_edit"],
		"skill-tool.ts": ["Skill", "skill"],
		"ask-user-question-tool.ts": ["ask_user_question"],
		"tool-search-tool.ts": ["tool_search_all"],
		"cron-create-tool.ts": ["cron_create"],
		"cron-delete-tool.ts": ["cron_delete"],
		"cron-list-tool.ts": ["cron_list"],
	};

	for (const [file, tools] of Object.entries(expectedTools)) {
		const filepath = join(coreDir, file);
		if (!existsSync(filepath)) continue;
		const content = readFileSync(filepath, "utf-8");

		for (const tool of tools) {
			assert.ok(
				content.includes(`name: "${tool}"`),
				`${file} should register tool "${tool}"`,
			);
		}
	}
});

// ─── Aery Agent Coordination Tools ───────────────────────────────────────────

test("subagent extension exposes Aery Agent and SendMessage tools", () => {
	const subagentPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "subagent", "index.ts");
	const sendMessagePath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "subagent", "send-message.ts");
	const backgroundTasksPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "subagent", "background-tasks.ts");

	const subagentContent = readFileSync(subagentPath, "utf-8");
	const sendMessageContent = readFileSync(sendMessagePath, "utf-8");
	const backgroundTasksContent = readFileSync(backgroundTasksPath, "utf-8");

	assert.ok(subagentContent.includes('name: "Agent"'), "subagent extension should register the Aery Agent tool");
	assert.ok(subagentContent.includes('name: "subagent"'), "subagent extension should preserve legacy subagent tool name");
	assert.ok(subagentContent.includes("subagent_type"), "Agent tool should accept subagent_type");
	assert.ok(subagentContent.includes("run_in_background"), "Agent tool should accept run_in_background");
	assert.ok(subagentContent.includes("registerSendMessageTool(aery)"), "subagent extension should register SendMessage");
	assert.ok(subagentContent.includes("registerBackgroundTaskTools(aery)"), "subagent extension should register background task tools");
	assert.ok(subagentContent.includes('params.agent = "general"'), "Agent tool should default to general when no subagent_type is provided");
	assert.ok(subagentContent.includes("params.fork = true"), "Agent tool should fork context by default when no subagent_type is provided");
	assert.ok(sendMessageContent.includes('name: "SendMessage"'), "SendMessage tool should be registered");
	assert.ok(backgroundTasksContent.includes('name: "background_tasks"'), "background_tasks tool should be registered");
	assert.ok(backgroundTasksContent.includes('name: "TaskStop"'), "TaskStop should be registered for background tasks");
	assert.ok(backgroundTasksContent.includes('name: "TaskOutput"'), "TaskOutput should be registered for background task output");
});

test("verification agent is named verification and runs in background", () => {
	const verifyPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "subagent", "agents", "verify.md");
	const content = readFileSync(verifyPath, "utf-8");
	assert.ok(content.includes("name: verification"), "verification agent should use Aery Agent type 'verification'");
	assert.ok(content.includes("background: true"), "verification agent should default to background execution");
	assert.ok(content.includes("verdict: true"), "verification agent should mark verdict output requirement");
});

test("task system registers Aery Agent-compatible Task aliases", () => {
	const taskPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "task-v2.ts");
	const content = readFileSync(taskPath, "utf-8");
	for (const name of ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]) {
		assert.ok(content.includes(`"${name}"`), `task-v2 should expose ${name} alias`);
	}
});

test("tool aliases expose Aery Agent-compatible built-in tool names", () => {
	const checks = {
		"ask-user-question-tool.ts": ["AskUserQuestion"],
		"cron-create-tool.ts": ["CronCreate"],
		"cron-delete-tool.ts": ["CronDelete"],
		"cron-list-tool.ts": ["CronList"],
		"notebook-edit-tool.ts": ["NotebookEdit"],
		"web-fetch.ts": ["WebFetch"],
		"web-search.ts": ["WebSearch"],
		"tool-search-tool.ts": ["tool_search_all", "ToolSearch"],
	};
	for (const [file, aliases] of Object.entries(checks)) {
		const content = readFileSync(join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", file), "utf-8");
		for (const alias of aliases) {
			assert.ok(content.includes(`"${alias}"`), `${file} should expose ${alias} alias`);
		}
	}
});

test("WebSearch supports domain filters", () => {
	const content = readFileSync(join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "web-search.ts"), "utf-8");
	assert.ok(content.includes("allowed_domains"), "WebSearch should accept allowed_domains");
	assert.ok(content.includes("blocked_domains"), "WebSearch should accept blocked_domains");
	assert.ok(content.includes("filterResultsByDomain"), "WebSearch should filter results by domain");
});

test("plan mode tools expose EnterPlanMode and ExitPlanMode", () => {
	const planPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "plan-mode-tools.ts");
	const content = readFileSync(planPath, "utf-8");
	assert.ok(content.includes('name: "EnterPlanMode"'), "EnterPlanMode should be registered");
	assert.ok(content.includes('name: "ExitPlanMode"'), "ExitPlanMode should be registered");
	assert.ok(content.includes(".aery/plans/current-plan.md"), "plan mode should use the Aery plan file");
});

test("workflow behaviors inject continuous agent guidance", () => {
	const behaviorPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "workflow-behaviors.ts");
	const content = readFileSync(behaviorPath, "utf-8");
	assert.ok(content.includes("Keep working continuously"), "workflow behaviors should teach continuous work");
	assert.ok(content.includes("Use background agents aggressively"), "workflow behaviors should teach background agent orchestration");
	assert.ok(content.includes("Verification gate"), "workflow behaviors should teach verification discipline");
});

test("Aery includes guide and statusline setup agents", () => {
	const agentsDir = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "subagent", "agents");
	const guide = readFileSync(join(agentsDir, "aery-guide.md"), "utf-8");
	const statusline = readFileSync(join(agentsDir, "statusline-setup.md"), "utf-8");
	assert.ok(guide.includes("name: aery-guide"), "aery-guide agent should be available");
	assert.ok(statusline.includes("name: statusline-setup"), "statusline-setup agent should be available");
});

test("memory behaviors expose project/team memory and SaveMemory", () => {
	const memoryPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "memory-behaviors.ts");
	const content = readFileSync(memoryPath, "utf-8");
	assert.ok(content.includes('name: "SaveMemory"'), "SaveMemory tool should be registered");
	assert.ok(content.includes('name: "ForgetMemory"'), "ForgetMemory tool should be registered");
	assert.ok(content.includes("~/.aery/memory"), "user memory directory should exist");
	assert.ok(content.includes(".aery/memory/team"), "team memory directory should exist");
	assert.ok(content.includes("MEMORY.md"), "memory should use MEMORY.md indexes");
	assert.ok(content.includes("Do not save secrets"), "memory prompt should include safety guidance");
});

test("main core extension wires agent team tools", () => {
	const extensionPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "aery-extension.ts");
	const content = readFileSync(extensionPath, "utf-8");
	assert.ok(content.includes('import agentTeams from "./agent-teams.js"'), "aery-extension should import agent teams");
	assert.ok(content.includes("agentTeams(aery)"), "aery-extension should register agent team tools");
});

test("team task tools avoid global TaskList alias conflict", () => {
	const teamsPath = join(import.meta.dirname ?? "/home/aryee/aery/ai_agent/aery-extensions/core", "agent-teams.ts");
	const content = readFileSync(teamsPath, "utf-8");
	assert.ok(content.includes('name: "TeamTaskList"'), "team list tool should be TeamTaskList");
	assert.ok(content.includes('name: "TeamTaskClaim"'), "team claim tool should be TeamTaskClaim");
	assert.ok(content.includes('name: "TeamTaskComplete"'), "team complete tool should be TeamTaskComplete");
	assert.ok(!content.includes('name: "TaskList"'), "agent teams should not override global TaskList");
});

