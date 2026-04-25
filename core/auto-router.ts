/**
 * Aery Auto Model Router (Phase 2.0)
 * Automatically switches between fast/cheap and powerful models based on task complexity.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

function parseYaml(text: string): any {
	const result: any = {};
	let currentKey: string | null = null;
	let currentList: string[] | null = null;

	for (const rawLine of text.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line || line.startsWith("#")) continue;

		const listItem = line.match(/^  - (.+)$/);
		if (listItem && currentList !== null) {
			currentList.push(listItem[1].trim());
			continue;
		}

		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (kv) {
			currentKey = kv[1];
			const val = kv[2].trim();
			if (!val) {
				result[currentKey] = [];
				currentList = result[currentKey];
			} else {
				result[currentKey] = val === "true" ? true : val === "false" ? false : val;
				currentList = null;
			}
		}
	}
	return result;
}

const CONFIG_PATH = join(homedir(), ".aery", "agent", "auto-router.yaml");

interface AutoRouterConfig {
	enabled: boolean;
	fast_model?: { provider: string; model_id: string };
	power_model?: { provider: string; model_id: string };
	simple_keywords: string[];
	complex_keywords: string[];
}

let config: AutoRouterConfig | null = null;
let manualOverride = false;

function loadConfig(): AutoRouterConfig | null {
	if (!existsSync(CONFIG_PATH)) return null;
	try {
		return parseYaml(readFileSync(CONFIG_PATH, "utf-8")) as AutoRouterConfig;
	} catch {
		return null;
	}
}

function classifyPrompt(text: string): "simple" | "complex" | "unknown" {
	if (!config) return "unknown";
	const lower = text.toLowerCase();
	
	const isSimple = config.simple_keywords.some((kw) => lower.includes(kw));
	const isComplex = config.complex_keywords.some((kw) => lower.includes(kw));
	
	if (isSimple && !isComplex) return "simple";
	if (isComplex && !isSimple) return "complex";
	return "unknown";
}

export default function (aery: ExtensionAPI) {
	config = loadConfig();

	aery.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		if (!config) config = { enabled: false, simple_keywords: [], complex_keywords: [] };
		// Auto-enable if /provider selected "Auto"
		try {
			const profiles = JSON.parse(readFileSync(join(homedir(), ".aery", "agent", "profiles.json"), "utf-8"));
			if (profiles.active === "auto") config.enabled = true;
		} catch {}
	});

	aery.on("before_agent_start", async (event, ctx) => {
		if (!config?.enabled || manualOverride) return;
		if (!config.fast_model || !config.power_model) return;

		const userMsg = event.messages.findLast((m) => m.role === "user");
		if (!userMsg) return;

		const text = userMsg.content
			.filter((c) => c.type === "text")
			.map((c) => (c as any).text)
			.join(" ");

		const classification = classifyPrompt(text);
		if (classification === "unknown") return;

		const targetModel = classification === "simple" ? config.fast_model : config.power_model;
		const model = ctx.modelRegistry.find(targetModel.provider, targetModel.model_id);

		if (model && model.id !== ctx.model?.id) {
			await aery.setModel(model);
			ctx.ui.notify(`Auto-router: switched to ${model.id} (${classification} task)`, "info");
		}
	});

	// Detect manual model changes
	aery.on("model_changed", () => {
		manualOverride = true;
	});
}
