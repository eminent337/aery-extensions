/**
 * Aery Model Failover
 * Automatically switches to next working model when current model fails.
 * Handles: rate limits, token shortages, API errors, expired keys.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

function parseYaml(text: string): any {
	const result: any = {};
	let currentKey: string | null = null;
	let currentList: any[] | null = null;
	let currentObj: any | null = null;

	for (const rawLine of text.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line || line.startsWith("#")) continue;

		// Nested object under list item: "  - provider: openai"
		const listObjItem = line.match(/^  - (\w+):\s*(.+)$/);
		if (listObjItem && currentList !== null) {
			currentObj = { [listObjItem[1]]: listObjItem[2].trim() };
			currentList.push(currentObj);
			continue;
		}

		// Continuation of nested object: "    model_id: gpt-4o"
		const nestedKv = line.match(/^    (\w+):\s*(.+)$/);
		if (nestedKv && currentObj !== null) {
			currentObj[nestedKv[1]] = nestedKv[2].trim();
			continue;
		}

		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (kv) {
			currentKey = kv[1];
			const val = kv[2].trim();
			if (!val) {
				result[currentKey] = [];
				currentList = result[currentKey];
				currentObj = null;
			} else {
				result[currentKey] = val === "true" ? true : val === "false" ? false : isNaN(Number(val)) ? val : Number(val);
				currentList = null;
				currentObj = null;
			}
		}
	}
	return result;
}

const CONFIG_PATH = join(homedir(), ".aery", "agent", "failover.yaml");

interface FailoverConfig {
	enabled: boolean;
	fallback_models: Array<{ provider: string; model_id: string }>;
	retry_after_minutes?: number;
}

const failedModels = new Set<string>();
const failureTimestamps = new Map<string, number>();

function loadConfig(): FailoverConfig | null {
	if (!existsSync(CONFIG_PATH)) return null;
	try {
		return parseYaml(readFileSync(CONFIG_PATH, "utf-8")) as FailoverConfig;
	} catch {
		return null;
	}
}

function shouldRetry(modelKey: string, retryMinutes: number): boolean {
	const lastFailure = failureTimestamps.get(modelKey);
	if (!lastFailure) return true;
	const elapsed = (Date.now() - lastFailure) / 1000 / 60;
	return elapsed >= retryMinutes;
}

export default function (aery: ExtensionAPI) {
	let config: FailoverConfig | null = null;

	aery.on("session_start", async (_event, ctx) => {
		config = loadConfig();
	});

	aery.on("after_provider_response", async (event, ctx) => {
		if (!config?.enabled || !config.fallback_models.length) return;
		// Detect rate limit (429) or auth errors (401/403)
		if (event.status !== 429 && event.status !== 401 && event.status !== 403) return;

		const currentModel = ctx.model;
		if (!currentModel) return;

		const currentKey = `${currentModel.provider}/${currentModel.id}`;
		failedModels.add(currentKey);
		failureTimestamps.set(currentKey, Date.now());

		const retryMinutes = config.retry_after_minutes || 60;

		for (const fallback of config.fallback_models) {
			const fallbackKey = `${fallback.provider}/${fallback.model_id}`;
			if (fallbackKey === currentKey) continue;
			if (failedModels.has(fallbackKey) && !shouldRetry(fallbackKey, retryMinutes)) continue;

			const model = ctx.modelRegistry.find(fallback.provider, fallback.model_id);
			if (!model) continue;

			ctx.ui.notify(`Failover: ${currentModel.id} (${event.status}), switching to ${model.id}`, "warning");
			await pi.setModel(model);
			return;
		}

		ctx.ui.notify("Failover: all fallback models exhausted", "error");
	});

	aery.registerCommand("failover", {
		description: "Manage model failover",
		handler: async (args, ctx) => {
			if (!args) {
				const status = config?.enabled ? "enabled" : "disabled";
				const failed = Array.from(failedModels).join(", ") || "none";
				ctx.ui.notify(`Failover: ${status}\nFailed models: ${failed}`, "info");
				return;
			}

			if (args === "reset") {
				failedModels.clear();
				failureTimestamps.clear();
				ctx.ui.notify("Failover: cleared failed models list", "info");
			} else if (args === "reload") {
				config = loadConfig();
				ctx.ui.notify("Failover: config reloaded", "info");
			} else {
				ctx.ui.notify("Usage: /failover [reset|reload]", "error");
			}
		},
	});
}
