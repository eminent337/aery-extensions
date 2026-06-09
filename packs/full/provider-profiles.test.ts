import assert from "node:assert/strict";
import test from "node:test";
import { shouldDisableProviderProfileOnModelSelect } from "./provider-profiles.ts";

test("manual model selection disables an active provider profile", () => {
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

test("provider profile initiated model selection keeps the profile active", () => {
	assert.equal(
		shouldDisableProviderProfileOnModelSelect({
			activeProfile: "openrouter",
			autoEnabled: false,
			autoRouterSwitching: false,
			providerProfileSwitching: true,
			source: "set",
		}),
		false,
	);
});

test("session restore does not disable provider profiles", () => {
	assert.equal(
		shouldDisableProviderProfileOnModelSelect({
			activeProfile: "openrouter",
			autoEnabled: false,
			autoRouterSwitching: false,
			providerProfileSwitching: false,
			source: "restore",
		}),
		false,
	);
});

test("manual model selection disables auto routing", () => {
	assert.equal(
		shouldDisableProviderProfileOnModelSelect({
			activeProfile: "auto",
			autoEnabled: true,
			autoRouterSwitching: false,
			providerProfileSwitching: false,
			source: "cycle",
		}),
		true,
	);
});
