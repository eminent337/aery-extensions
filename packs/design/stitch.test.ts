import assert from "node:assert/strict";
import test from "node:test";
import {
	buildStitchToolArgs,
	getStitchAuthStatus,
	parseStitchCommand,
	stitchSetupMessage,
} from "./stitch.ts";

test("prefers API key auth when STITCH_API_KEY is present", () => {
	const status = getStitchAuthStatus({ STITCH_API_KEY: "key", STITCH_USE_SYSTEM_GCLOUD: "1" });

	assert.equal(status.mode, "api-key");
	assert.equal(status.configured, true);
});

test("uses system gcloud auth when requested", () => {
	const status = getStitchAuthStatus({ STITCH_USE_SYSTEM_GCLOUD: "1", GOOGLE_CLOUD_PROJECT: "demo" });

	assert.equal(status.mode, "gcloud");
	assert.equal(status.configured, true);
	assert.equal(status.projectId, "demo");
});

test("reports missing auth when no Stitch environment is configured", () => {
	const status = getStitchAuthStatus({});

	assert.equal(status.mode, "missing");
	assert.equal(status.configured, false);
	assert.match(stitchSetupMessage(status), /\/stitch auth/);
});

test("builds stitch-mcp tool invocation arguments", () => {
	assert.deepEqual(buildStitchToolArgs("list_projects", { filter: "view=owned" }), [
		"-y",
		"@_davideast/stitch-mcp",
		"tool",
		"list_projects",
		"-d",
		'{"filter":"view=owned"}',
	]);
});

test("parses stitch slash commands", () => {
	assert.deepEqual(parseStitchCommand("screens projects/123"), {
		name: "screens",
		rest: "projects/123",
	});
	assert.deepEqual(parseStitchCommand(""), { name: "help", rest: "" });
});
