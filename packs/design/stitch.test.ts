import assert from "node:assert/strict";
import test from "node:test";
import {
	buildStitchEnv,
	buildStitchToolArgs,
	formatStitchError,
	formatStitchToolResult,
	getStitchAuthStatus,
	getStitchDirectAuth,
	normalizeStitchToolPayload,
	parseStitchCommand,
	stitchMainMenuOptions,
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

test("uses saved API key config when environment is empty", () => {
	const status = getStitchAuthStatus({}, { authMode: "api-key", apiKey: "saved", projectId: "stitch-project" });

	assert.equal(status.mode, "api-key");
	assert.equal(status.configured, true);
	assert.equal(status.projectId, "stitch-project");
});

test("injects saved config into Stitch MCP environment", () => {
	assert.deepEqual(
		buildStitchEnv(
			{ PATH: "/bin" },
			{ authMode: "gcloud", projectId: "demo-project", accessToken: "token" },
		),
		{
			PATH: "/bin",
			STITCH_USE_SYSTEM_GCLOUD: "1",
			STITCH_PROJECT_ID: "demo-project",
			GOOGLE_CLOUD_PROJECT: "demo-project",
			STITCH_ACCESS_TOKEN: "token",
		},
	);
});

test("reports missing auth when no Stitch environment is configured", () => {
	const status = getStitchAuthStatus({}, {});

	assert.equal(status.mode, "missing");
	assert.equal(status.configured, false);
	assert.match(stitchSetupMessage(status), /Run \/stitch/);
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

test("detects direct Stitch API auth from saved API key config", () => {
	assert.deepEqual(getStitchDirectAuth({}, { authMode: "api-key", apiKey: "saved-key" }), {
		kind: "api-key",
		apiKey: "saved-key",
	});
});

test("normalizes project resource names for raw Stitch API tools", () => {
	assert.deepEqual(normalizeStitchToolPayload("list_screens", { projectName: "projects/123456" }), {
		projectId: "123456",
	});
	assert.deepEqual(
		normalizeStitchToolPayload("get_screen", { projectName: "projects/123456", screenId: "screen-a" }),
		{
			projectId: "123456",
			screenId: "screen-a",
			name: "projects/123456/screens/screen-a",
		},
	);
});

test("formats stitch-mcp schema reference errors with a direct API hint", () => {
	assert.match(
		formatStitchError(new Error("can't resolve reference #/$defs/ScreenInstance from id #")),
		/Stitch MCP CLI failed while resolving its tool schema/,
	);
	assert.match(formatStitchError(new Error("can't resolve reference #/$defs/ScreenInstance from id #")), /direct Stitch API/);
});

test("parses stitch slash commands", () => {
	assert.deepEqual(parseStitchCommand("screens projects/123"), { name: "menu", rest: "" });
	assert.deepEqual(parseStitchCommand("auth gcloud"), { name: "menu", rest: "" });
	assert.deepEqual(parseStitchCommand(""), { name: "menu", rest: "" });
});

test("stitch main menu prioritizes interactive configuration", () => {
	assert.deepEqual(stitchMainMenuOptions().slice(0, 3), [
		"Configure with API key",
		"Configure with gcloud",
		"Guided Stitch MCP setup",
	]);
});

test("formats Stitch project lists without heavyweight fields by default", () => {
	const result = formatStitchToolResult(
		"list_projects",
		JSON.stringify({
			projects: [
				{
					name: "projects/123456",
					title: "Dashboard",
					visibility: "PRIVATE",
					deviceType: "DESKTOP",
					projectType: "PROJECT_DESIGN",
					updateTime: "2026-05-01T00:00:00Z",
					thumbnailScreenshot: { downloadUrl: "https://example.com/very-long-image" },
					designTheme: { designMd: "huge theme document", namedColors: { primary: "#000" } },
				},
			],
		}),
	);

	assert.deepEqual(JSON.parse(result), {
		projects: [
			{
				projectId: "123456",
				name: "projects/123456",
				title: "Dashboard",
				visibility: "PRIVATE",
				deviceType: "DESKTOP",
				projectType: "PROJECT_DESIGN",
				updateTime: "2026-05-01T00:00:00Z",
			},
		],
		count: 1,
	});
	assert.doesNotMatch(result, /downloadUrl|designTheme|designMd/);
});

test("keeps raw Stitch project output when requested", () => {
	const raw = JSON.stringify({
		projects: [{ name: "projects/123456", thumbnailScreenshot: { downloadUrl: "https://example.com/raw" } }],
	});

	assert.equal(formatStitchToolResult("list_projects", raw, true), raw);
});

test("formats generated screens without dumping output components", () => {
	const result = formatStitchToolResult(
		"generate_screen_from_text",
		JSON.stringify({
			projectId: "2763830009615060503",
			sessionId: "296031180902487325",
			outputComponents: [
				{
					design: {
						screens: [
							{
								name: "projects/2763830009615060503/screens/screen-1",
								id: "screen-1",
								title: "Ground Intelligence",
								deviceType: "DESKTOP",
							},
						],
					},
				},
			],
			designSystem: {
				styleGuidelines: "very large document",
			},
		}),
	);

	assert.deepEqual(JSON.parse(result), {
		projectId: "2763830009615060503",
		sessionId: "296031180902487325",
		screens: [
			{
				screenId: "screen-1",
				name: "projects/2763830009615060503/screens/screen-1",
				title: "Ground Intelligence",
				deviceType: "DESKTOP",
			},
		],
		screenCount: 1,
	});
	assert.doesNotMatch(result, /outputComponents|styleGuidelines/);
});

test("formats screen code without dumping full html by default", () => {
	const html = "<!DOCTYPE html><html><head><title>Demo</title></head><body><main>Hello</main></body></html>";
	const result = formatStitchToolResult("get_screen_code", html);
	const parsed = JSON.parse(result);

	assert.equal(parsed.kind, "html");
	assert.equal(parsed.htmlLength, html.length);
	assert.equal(parsed.hasDoctype, true);
	assert.match(parsed.preview, /<!DOCTYPE html>/);
	assert.doesNotMatch(result, /<body><main>Hello<\/main><\/body>/);
});
