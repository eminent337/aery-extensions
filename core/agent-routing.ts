/**
 * Agent Routing Extension
 *
 * Routes different agent types to different models.
 * "Explore uses deepseek, Plan uses opus, default uses sonnet."
 *
 * Config: ~/.aery/agent/agent-routing.json
 *
 * {
 *   "routing": {
 *     "Explore": "deepseek-v4-flash",
 *     "Plan": "claude-opus-4",
 *     "Verification": "claude-sonnet-4",
 *     "default": "claude-sonnet-4"
 *   },
 *   "models": {
 *     "deepseek-v4-flash": {
 *       "provider": "deepseek",
 *       "model": "deepseek-v4-flash"
 *     }
 *   }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";

interface RoutingConfig {
	routing: Record<string, string>;
	models?: Record<
		string,
		{
			provider?: string;
			model: string;
			baseUrl?: string;
			apiKey?: string;
		}
	>;
}

function loadConfig(): RoutingConfig {
	const path = join(homedir(), ".aery", "agent", "agent-routing.json");
	if (!existsSync(path)) {
		return { routing: {} };
	}
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return { routing: {} };
	}
}

function normalizeAgentName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[-_\s]+/g, "")
		.trim();
}

export default function agentRouting(pi: ExtensionAPI): void {
	const config = loadConfig();
	if (Object.keys(config.routing).length === 0) return;

	// Build normalized lookup
	const routeMap = new Map<string, string>();
	for (const [agent, model] of Object.entries(config.routing)) {
		routeMap.set(normalizeAgentName(agent), model);
	}

	// Track current agent context
	let currentAgent: string | null = null;

	// Intercept agent start to set model
	pi.on("before_agent_start", (event) => {
		// Try to detect agent type from system prompt or context
		const systemPrompt = event.systemPrompt ?? "";

		// Check for agent type markers in the system prompt
		for (const [agentName, model] of routeMap) {
			const marker = `[agent:${agentName}]`;
			if (systemPrompt.toLowerCase().includes(marker)) {
				currentAgent = agentName;
				const targetModel = model;

				// Resolve model name
				const modelConfig = config.models?.[targetModel];
				const modelName = modelConfig?.model ?? targetModel;

				pi.setModel(modelName);
				return { systemPrompt: event.systemPrompt };
			}
		}

		// Check for default routing
		const defaultModel = config.routing["default"];
		if (defaultModel && !currentAgent) {
			const modelConfig = config.models?.[defaultModel];
			const modelName = modelConfig?.model ?? defaultModel;
			pi.setModel(modelName);
		}

		return { systemPrompt: event.systemPrompt };
	});

	// Reset on turn end
	pi.on("turn_end", () => {
		currentAgent = null;
	});

}
