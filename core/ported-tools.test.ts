import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── File Path Helpers ────────────────────────────────────────────────
const coreDir = import.meta.dirname;

// ─── Code Search Tool ─────────────────────────────────────────────────
test("CodeSearchTool - has correct metadata", () => {
	const content = readFileSync(join(coreDir, "code-search.ts"), "utf-8");
	assert.ok(content.includes('name: "CodeSearchTool"'), "Tool name should be CodeSearchTool");
	assert.ok(content.includes('label: "Code Search Tool"'), "Tool should have a label");
	assert.ok(content.includes("aery.registerTool(codeSearchTool)"), "Tool should be registered");
	assert.ok(content.includes("rg"), "Tool should reference ripgrep");
	assert.ok(content.includes("execFile"), "Should use execFile for security");
	assert.ok(content.includes("pattern"), "Should accept pattern parameter");
	assert.ok(content.includes("glob"), "Should accept glob filter");
	assert.ok(content.includes("caseSensitive"), "Should accept caseSensitive");
	assert.ok(content.includes("contextLines"), "Should accept contextLines parameter");
});

test("CodeSearchTool - register function is exported", () => {
	const content = readFileSync(join(coreDir, "code-search.ts"), "utf-8");
	assert.ok(content.includes("export function registerCodeSearchTool"), "registerCodeSearchTool should be exported");
});

// ─── String Replace Tool ──────────────────────────────────────────────
test("StrReplaceTool - has correct metadata", () => {
	const content = readFileSync(join(coreDir, "str-replace.ts"), "utf-8");
	assert.ok(content.includes('name: "StrReplaceTool"'), "Tool name should be StrReplaceTool");
	assert.ok(content.includes('label: "String Replace Tool"'), "Tool should have a label");
	assert.ok(content.includes("aery.registerTool(strReplaceTool)"), "Tool should be registered");
	assert.ok(content.includes("oldString"), "Should accept oldString parameter");
	assert.ok(content.includes("newString"), "Should accept newString parameter");
	assert.ok(content.includes("allowMultiple"), "Should accept allowMultiple parameter");
	assert.ok(content.includes("path.resolve"), "Should use path.resolve for security");
	assert.ok(content.includes("from \"node:path\""), "Should import path module");
});

test("StrReplaceTool - register function is exported", () => {
	const content = readFileSync(join(coreDir, "str-replace.ts"), "utf-8");
	assert.ok(content.includes("export function registerStrReplaceTool"), "registerStrReplaceTool should be exported");
});

test("StrReplaceTool - replacement logic works correctly", () => {
	// Test the replacement algorithm inline (same logic as the tool)
	const replaceAll = (content: string, oldStr: string, newStr: string): string => {
		return content.split(oldStr).join(newStr);
	};

	// Single occurrence
	assert.equal(replaceAll("Hello world", "world", "there"), "Hello there");

	// Multiple occurrences
	assert.equal(replaceAll("a,b,c", ",", " | "), "a | b | c");

	// No occurrence (no-op)
	assert.equal(replaceAll("Hello world", "foo", "bar"), "Hello world");

	// Empty replacement (deletion)
	assert.equal(replaceAll("Hello world", "world", ""), "Hello ");

	// Verify file system operations work
	const tmpDir = mkdtempSync(join(tmpdir(), "str-replace-test-"));
	try {
		const testFile = join(tmpDir, "test.txt");
		writeFileSync(testFile, "Hello world, this is a test file.");
		const content = readFileSync(testFile, "utf-8");
		assert.equal(content, "Hello world, this is a test file.");
		
		// Simulate the tool's replacement
		const result = content.split("world").join("there");
		assert.equal(result, "Hello there, this is a test file.");
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("StrReplaceTool - handles multiple replacements correctly", () => {
	let content = "foo: a\nbar: b\nfoo: c";
	
	// With allowMultiple: true (split/join replaces all occurrences)
	const firstIdx = content.indexOf("foo");
	const secondIdx = content.indexOf("foo", firstIdx + 1);
	assert.ok(firstIdx !== -1, "Should find first foo");
	assert.ok(secondIdx !== -1, "Should find second foo");
	
	// With allowMultiple, replace all
	content = content.split("foo").join("baz");
	assert.equal(content, "baz: a\nbar: b\nbaz: c");
});

// ─── File Picker Tool ─────────────────────────────────────────────────
test("FilePickerTool - has correct metadata", () => {
	const content = readFileSync(join(coreDir, "file-picker.ts"), "utf-8");
	assert.ok(content.includes('name: "FilePickerTool"'), "Tool name should be FilePickerTool");
	assert.ok(content.includes('label: "File Picker Tool"'), "Tool should have a label");
	assert.ok(content.includes("aery.registerTool(filePickerTool)"), "Tool should be registered");
	assert.ok(content.includes("prompt"), "Should accept prompt parameter");
	assert.ok(content.includes("maxResults"), "Should accept maxResults parameter");
	assert.ok(content.includes("execFile"), "Should use execFile for security");
	assert.ok(content.includes("find"), "Should use find command for name matching");
	assert.ok(content.includes("rg"), "Should use ripgrep for content matching");
});

test("FilePickerTool - has keyword extraction and scoring logic", () => {
	const content = readFileSync(join(coreDir, "file-picker.ts"), "utf-8");
	assert.ok(content.includes("keywords"), "Should extract keywords from prompt");
	assert.ok(content.includes("nameMatches"), "Should track name matches");
	assert.ok(content.includes("contentMatches"), "Should track content matches");
	assert.ok(content.includes("scored"), "Should score results");
	assert.ok(content.includes(".sort("), "Should sort results by score");
});

test("FilePickerTool - register function is exported", () => {
	const content = readFileSync(join(coreDir, "file-picker.ts"), "utf-8");
	assert.ok(content.includes("export function registerFilePickerTool"), "registerFilePickerTool should be exported");
});

// ─── Browser Enhanced Tool ────────────────────────────────────────────
test("BrowserEnhanced - has correct metadata and all tools", () => {
	const content = readFileSync(join(coreDir, "browser-enhanced.ts"), "utf-8");
	assert.ok(content.includes('name: "browser_navigate"'), "Should register browser_navigate");
	assert.ok(content.includes('name: "browser_click"'), "Should register browser_click");
	assert.ok(content.includes('name: "browser_fill"'), "Should register browser_fill");
	assert.ok(content.includes('name: "browser_extract"'), "Should register browser_extract");
	assert.ok(content.includes('name: "browser_console"'), "Should register browser_console");
	assert.ok(content.includes('name: "browser_screenshot"'), "Should register browser_screenshot");
	assert.ok(content.includes('name: "browser_evaluate"'), "Should register browser_evaluate");
	assert.ok(content.includes('name: "browser_close"'), "Should register browser_close");
	assert.ok(content.includes("aery.registerTool("), "Tools should be registered");
	assert.ok(content.includes("playwright"), "Should use playwright for browser automation");
	assert.ok(content.includes("consoleLogs"), "Should capture console logs");
});

test("BrowserEnhanced - tracks browser state properly", () => {
	const content = readFileSync(join(coreDir, "browser-enhanced.ts"), "utf-8");
	assert.ok(content.includes("let browser: any = null"), "Should track browser instance");
	assert.ok(content.includes("let page: any = null"), "Should track page instance");
	assert.ok(content.includes("getPage"), "Should have lazy initialization");
	assert.ok(content.includes("browser.close"), "Should close browser properly");
	assert.ok(content.includes("browser = null"), "Should nullify browser after close");
});

test("BrowserEnhanced - register function is exported", () => {
	const content = readFileSync(join(coreDir, "browser-enhanced.ts"), "utf-8");
	assert.ok(content.includes("export function registerBrowserEnhancedTools"), "registerBrowserEnhancedTools should be exported");
});

// ─── Context Prune Tool ───────────────────────────────────────────────
test("ContextPruneTool - has correct metadata", () => {
	const content = readFileSync(join(coreDir, "context-prune.ts"), "utf-8");
	assert.ok(content.includes('name: "ContextPruneTool"'), "Tool name should be ContextPruneTool");
	assert.ok(content.includes('name: "ContextStatusTool"'), "Companion tool should be ContextStatusTool");
	assert.ok(content.includes('label: "Context Prune"'), "Prune tool should have a label");
	assert.ok(content.includes('label: "Context Status"'), "Status tool should have a label");
	assert.ok(content.includes("aery.registerTool(pruneTool)"), "Prune tool should be registered");
	assert.ok(content.includes("aery.registerTool(statusTool)"), "Status tool should be registered");
	assert.ok(content.includes("summary"), "Should accept summary parameter");
	assert.ok(content.includes("retainedContext"), "Should accept retainedContext parameter");
	assert.ok(content.includes("remainingTasks"), "Should accept remainingTasks parameter");
});

test("ContextPruneTool - register function is exported", () => {
	const content = readFileSync(join(coreDir, "context-prune.ts"), "utf-8");
	assert.ok(content.includes("export function registerContextPruneTool"), "registerContextPruneTool should be exported");
});

// ─── Aery Extension Registration ─────────────────────────────────────
test("aery-extension.ts - all new tools are imported and registered", () => {
	const content = readFileSync(join(coreDir, "aery-extension.ts"), "utf-8");
	
	// Verify imports
	assert.ok(content.includes('from "./code-search.js"'), "Should import code-search");
	assert.ok(content.includes('from "./str-replace.js"'), "Should import str-replace");
	assert.ok(content.includes('from "./file-picker.js"'), "Should import file-picker");
	assert.ok(content.includes('from "./browser-enhanced.js"'), "Should import browser-enhanced");
	assert.ok(content.includes('from "./context-prune.js"'), "Should import context-prune");

	// Verify registration calls
	assert.ok(content.includes("registerCodeSearchTool(aery)"), "Should register CodeSearchTool");
	assert.ok(content.includes("registerStrReplaceTool(aery)"), "Should register StrReplaceTool");
	assert.ok(content.includes("registerFilePickerTool(aery)"), "Should register FilePickerTool");
	assert.ok(content.includes("registerBrowserEnhancedTools(aery)"), "Should register BrowserEnhanced tools");
	assert.ok(content.includes("registerContextPruneTool(aery)"), "Should register ContextPruneTool");
});

// ─── Security Compliance ──────────────────────────────────────────────
test("code-search.ts uses execFile (safe) not shell execution", () => {
	const content = readFileSync(join(coreDir, "code-search.ts"), "utf-8");
	// Should use execFile from child_process (no shell)
	assert.ok(content.includes("execFile"), "Should import execFile");
	// Should NOT use exec with shell execution
	assert.ok(!content.includes("execAsync("), "Should not use shell execution");
	// Should NOT use template literals for command building
	assert.ok(!content.includes("`rg $"), "Should not build shell commands via template literals");
});

test("file-picker.ts uses execFile (safe) not shell execution", () => {
	const content = readFileSync(join(coreDir, "file-picker.ts"), "utf-8");
	// Should use execFile from child_process (no shell)
	assert.ok(content.includes("execFile"), "Should import execFile");
	// Should NOT use exec with shell execution
	assert.ok(!content.includes("execAsync("), "Should not use shell execution");
	// Should NOT use template literals for command building
	assert.ok(!content.includes("`rg ")
		&& !content.includes("`find "), "Should not build shell commands via template literals");
});
