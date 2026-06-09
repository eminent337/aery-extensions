import assert from "node:assert/strict";
import test from "node:test";
import { compactToolResultContent, isBuiltinToolName } from "./circuit-breaker.ts";

test("recognizes built-in tools", () => {
	assert.equal(isBuiltinToolName("bash"), true);
	assert.equal(isBuiltinToolName("read"), true);
	assert.equal(isBuiltinToolName("stitch_get_screen_code"), false);
});

test("compacts oversized extension html tool results", () => {
	const html = "<!DOCTYPE html><html><body>" + "x".repeat(5000) + "</body></html>";
	const result = compactToolResultContent("stitch_get_screen_code", [{ type: "text", text: html }]);
	const text = result[0] && result[0].type === "text" ? result[0].text : "";

	assert.match(text, /Output compacted/);
	assert.match(text, /HTML result/);
	assert.doesNotMatch(text, /x{100}/);
});

test("leaves small extension text results unchanged", () => {
	const content = [{ type: "text" as const, text: "Task claimed: demo" }];
	assert.deepEqual(compactToolResultContent("TaskClaim", content), content);
});
