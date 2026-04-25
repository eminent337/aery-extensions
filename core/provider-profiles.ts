/**
 * Aery Provider Wizard — matches OpenClaude's /provider flow.
 * Multi-step: choose type → configure → save profile.
 * Includes Auto (smart routing) as a provider option.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const PROFILES_PATH = join(homedir(), ".aery", "agent", "profiles.json");
const MODELS_PATH = join(homedir(), ".aery", "agent", "models.json");

interface Profile { name: string; provider: string; modelId: string }
interface ProfilesFile { active?: string; profiles: Profile[] }

function loadProfiles(): ProfilesFile {
	if (!existsSync(PROFILES_PATH)) return { profiles: [] };
	try { return JSON.parse(readFileSync(PROFILES_PATH, "utf-8")); }
	catch { return { profiles: [] }; }
}
function saveProfiles(d: ProfilesFile) { writeFileSync(PROFILES_PATH, JSON.stringify(d, null, 2)); }
function loadModels(): any {
	if (!existsSync(MODELS_PATH)) return { providers: {} };
	try { return JSON.parse(readFileSync(MODELS_PATH, "utf-8")); }
	catch { return { providers: {} }; }
}
function saveModels(d: any) { writeFileSync(MODELS_PATH, JSON.stringify(d, null, 2)); }

function addProviderModel(name: string, baseUrl: string, apiKey: string, modelId: string) {
	const m = loadModels();
	m.providers[name] = {
		baseUrl, api: "openai-completions",
		...(apiKey ? { apiKey } : {}),
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
		models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
	};
	saveModels(m);
}

function addToEnabledModels(provider: string, modelId: string) {
	try {
		const settingsPath = join(homedir(), ".aery", "agent", "settings.json");
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		const entry = `${provider}/${modelId}`;
		if (!settings.enabledModels) settings.enabledModels = [];
		if (!settings.enabledModels.includes(entry)) {
			settings.enabledModels.push(entry);
			writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
		}
	} catch {}
}

function saveProfile(name: string, provider: string, modelId: string) {
	const d = loadProfiles();
	const idx = d.profiles.findIndex(p => p.name === name);
	if (idx >= 0) d.profiles[idx] = { name, provider, modelId };
	else d.profiles.push({ name, provider, modelId });
	d.active = name;
	saveProfiles(d);
	addToEnabledModels(provider, modelId);
}

function deleteProfile(name: string) {
	const d = loadProfiles();
	d.profiles = d.profiles.filter(p => p.name !== name);
	if (d.active === name) d.active = d.profiles[0]?.name;
	saveProfiles(d);
}

// Auto-routing
let autoEnabled = false;
let failedModels = new Set<string>();
let workingModels = new Set<string>();
let justFailedOver = false;
let autoRouterSwitching = false;
let lastPrompt = ""; // track last prompt for retry after failover
const COMPLEX = ["implement","build","create","refactor","debug","architect","design","fix","write","migrate","optimize"];
const SIMPLE  = ["explain","summarize","translate","what is","describe","list","show me","tell me","how does"];
function classify(p: string): "complex"|"simple"|"unknown" {
	const l = p.toLowerCase();
	if (COMPLEX.some(k => l.includes(k))) return "complex";
	if (SIMPLE.some(k => l.includes(k))) return "simple";
	return "unknown";
}

export default function (aery: ExtensionAPI) {

	aery.on("session_start", async (_event, ctx) => {
		const d = loadProfiles();
		if (d.active === "auto") { autoEnabled = true; return; }
		autoEnabled = false;
		if (!d.active) return;
		const p = d.profiles.find(x => x.name === d.active);
		if (!p) return;
		const model = ctx.modelRegistry.find(p.provider, p.modelId);
		if (model) await aery.setModel(model);
	});

	// Always capture last prompt for retry after failover
	aery.on("before_agent_start", async (event) => {
		lastPrompt = (event as any).prompt ?? "";
	});

	aery.on("before_agent_start", async (event, ctx) => {
		if (!autoEnabled) return;
		if (justFailedOver) { justFailedOver = false; return; }

		// Only use models from enabledModels in settings.json (user's selected models)
		let enabledIds: Set<string> | null = null;
		try {
			const settings = JSON.parse(readFileSync(join(homedir(), ".aery", "agent", "settings.json"), "utf-8"));
			if (settings.enabledModels?.length > 0) {
				enabledIds = new Set(settings.enabledModels.map((e: string) => e.split("/").slice(1).join("/")));
			}
		} catch {}

		const all = ctx.modelRegistry.getAvailable().filter(m =>
			!failedModels.has(`${m.provider}/${m.id}`) &&
			(!enabledIds || enabledIds.has(m.id))
		);
		if (!all.length) { failedModels.clear(); return; }

		// Prefer confirmed working, then free, then anything
		const confirmed = all.filter(m => workingModels.has(`${m.provider}/${m.id}`));
		const free = all.filter(m => m.id.endsWith(":free"));
		const candidates = confirmed.length > 0 ? confirmed : (free.length > 0 ? free : all);

		const task = classify((event as any).prompt ?? "");
		let target = candidates[0];

		if (task === "simple") {
			target = [...candidates].sort((a, b) => (a.contextWindow ?? 0) - (b.contextWindow ?? 0))[0];
		} else if (task === "complex") {
			target = [...candidates].sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))[0];
		}

		if (target && target.id !== ctx.model?.id) {
			autoRouterSwitching = true;
			await aery.setModel(target);
			autoRouterSwitching = false;
			ctx.ui.notify(`Auto: ${task} → ${target.id}${confirmed.length > 0 ? " ✓" : ""}`, "info");
		}
	});

	aery.on("model_select", async (event, ctx) => {
		if (!autoEnabled) return;
		if (autoRouterSwitching) return; // auto-router triggered this, don't disable
		if ((event as any).source === "restore") return;
		autoEnabled = false;
		const d = loadProfiles();
		d.active = undefined;
		saveProfiles(d);
		ctx.ui.notify(`Auto-router disabled. Using: ${event.model?.id}`, "info");
	});

	aery.on("after_provider_response", async (event, ctx) => {
		if (!autoEnabled) return;
		if (event.status >= 200 && event.status < 300) {
			const cur = ctx.model;
			if (cur) workingModels.add(`${cur.provider}/${cur.id}`);
			justFailedOver = false;
			return;
		}
		if (event.status !== 402 && event.status !== 429 && event.status !== 401 && event.status !== 403) return;

		const cur = ctx.model;
		if (!cur) return;
		const curKey = `${cur.provider}/${cur.id}`;
		failedModels.add(curKey);

		// Find next free working model
		const all = ctx.modelRegistry.getAvailable().filter(m => !failedModels.has(`${m.provider}/${m.id}`));
		const free = all.filter(m => m.id.endsWith(":free"));
		const pool = free.length > 0 ? free : all;
		const next = pool[0];

		if (next) {
			ctx.ui.notify(`Auto: ${cur.id} failed (${event.status}), retrying with ${next.id}...`, "warning");
			justFailedOver = true;
			autoRouterSwitching = true;
			await aery.setModel(next);
			autoRouterSwitching = false;
			// Retry the same prompt on the new model
			if (lastPrompt) {
				aery.sendUserMessage(lastPrompt, { deliverAs: "followUp" });
			}
		} else {
			failedModels.clear();
			ctx.ui.notify("Auto: all models failed, resetting", "error");
		}
	});

	aery.registerCommand("provider", {
		description: "Set up a provider profile",
		handler: async (_args, ctx) => {
			const d = loadProfiles();
			const currentLabel = d.active ?? "none";

			// Build options — same as OpenClaude
			const options = [
				"Auto              — Smart routing across all working models",
				"Ollama            — Use a local Ollama model with no API key",
				"OpenAI-compatible — GPT-4o, DeepSeek, OpenRouter, Groq, LM Studio, and similar APIs",
				"Gemini            — Use Google Gemini with API key, access token, or local ADC",
				"Mistral           — Use Mistral with API key",
				"Codex             — Use existing ChatGPT Codex CLI auth or env credentials",
			];

			// Added providers + management
			if (d.profiles.length > 0) {
				options.push("─────────────────────────────────────────────────────────");
				options.push("  Added providers     — Switch between your saved providers");
				options.push("  Delete provider     — Remove a saved provider");
			}

			const choice = await ctx.ui.select(
				`Set up a provider profile  (current: ${currentLabel})`,
				options
			);
			if (!choice || choice.startsWith("─")) return;

			// ── Auto ──────────────────────────────────────────────────────
			if (choice.startsWith("Auto")) {
				autoEnabled = true;
				failedModels.clear();
				d.active = "auto";
				saveProfiles(d);
				const available = ctx.modelRegistry.getAvailable();
				ctx.ui.notify(
					`Auto routing enabled.\n` +
					`Routes between ${available.length} available model${available.length !== 1 ? "s" : ""}.\n` +
					`Simple tasks → fast model · Complex tasks → powerful model.\n` +
					`Switches automatically if a model fails or runs out of tokens.`,
					"info"
				);
				return;
			}

			// ── Ollama ────────────────────────────────────────────────────
			if (choice.startsWith("Ollama")) {
				const baseUrl = await ctx.ui.input(
					"Ollama base URL (leave blank for http://localhost:11434/v1):",
					"http://localhost:11434/v1"
				);
				const url = baseUrl?.trim() || "http://localhost:11434/v1";
				const modelId = await ctx.ui.input("Model ID:", "llama3.2");
				if (!modelId) return;
				addProviderModel("ollama", url, "", modelId);
				saveProfile("ollama", "ollama", modelId);
				ctx.ui.notify(`Saved Ollama profile: ${modelId}. Switching now...`, "info");
				return;
			}

			// ── OpenAI-compatible ─────────────────────────────────────────
			if (choice.startsWith("OpenAI-compatible")) {
				// Step 1: API key
				const apiKey = await ctx.ui.input(
					"Step 1 of 3 — Enter the API key for your OpenAI-compatible provider:",
					"sk-..."
				);
				if (apiKey === undefined) return;
				if (!apiKey.trim() || apiKey === "sk-...") { ctx.ui.notify("API key required", "warning"); return; }

				// Step 2: Base URL
				const baseUrl = await ctx.ui.input(
					"Step 2 of 3 — Base URL (leave blank for https://api.openai.com/v1):",
					"https://api.openai.com/v1"
				);
				const url = baseUrl?.trim() || "https://api.openai.com/v1";

				// Step 3: Model
				const modelId = await ctx.ui.input(
					"Step 3 of 3 — Model ID:",
					"gpt-4o"
				);
				if (!modelId) return;

				// Derive provider name from URL
				let name = "openai-compatible";
				if (/groq/i.test(url)) name = "groq";
				else if (/openrouter/i.test(url)) name = "openrouter";
				else if (/nvidia/i.test(url)) name = "nvidia";
				else if (/deepseek/i.test(url)) name = "deepseek";
				else if (/together/i.test(url)) name = "together";
				else if (/mistral/i.test(url)) name = "mistral";
				else if (/azure/i.test(url)) name = "azure";
				else if (/localhost|127\.0\.0\.1/i.test(url)) name = "local";

				addProviderModel(name, url, apiKey, modelId);
				saveProfile(name, name, modelId);
				const newModel = ctx.modelRegistry.find(name, modelId);
				if (newModel) {
					autoRouterSwitching = true;
					await aery.setModel(newModel);
					autoRouterSwitching = false;
					ctx.ui.notify(`Switched to ${name}/${modelId}`, "info");
				} else {
					ctx.ui.notify(`Saved ${name} profile: ${modelId}. Restart aery to use.`, "info");
				}
				return;
			}

			// ── Gemini ────────────────────────────────────────────────────
			if (choice.startsWith("Gemini")) {
				const authMethod = await ctx.ui.select(
					"Gemini — Choose auth method:",
					[
						"API key           — Use a Gemini API key from Google AI Studio",
						"Access token      — Use a short-lived access token",
						"ADC               — Application Default Credentials (gcloud auth)",
					]
				);
				if (!authMethod) return;

				if (authMethod.startsWith("API key")) {
					const apiKey = await ctx.ui.input("Gemini API key:", "AIza...");
					if (apiKey === undefined) return;
					if (!apiKey.trim() || apiKey === "AIza...") { ctx.ui.notify("API key required", "warning"); return; }
					const modelId = await ctx.ui.input("Model:", "gemini-2.0-flash");
					if (!modelId) return;
					addProviderModel("gemini", "https://generativelanguage.googleapis.com/v1beta/openai", apiKey, modelId);
					saveProfile("gemini", "gemini", modelId);
					ctx.ui.notify(`Saved Gemini profile: ${modelId}. Switching now...`, "info");
				} else if (authMethod.startsWith("Access token")) {
					const token = await ctx.ui.input("Access token:", "ya29...");
					if (token === undefined) return;
					const modelId = await ctx.ui.input("Model:", "gemini-2.0-flash");
					if (!modelId) return;
					addProviderModel("gemini", "https://generativelanguage.googleapis.com/v1beta/openai", token, modelId);
					saveProfile("gemini", "gemini", modelId);
					ctx.ui.notify(`Saved Gemini profile: ${modelId}. Switching now...`, "info");
				} else {
					ctx.ui.notify(
						"ADC setup:\n1. Run: gcloud auth application-default login\n2. Set GOOGLE_CLOUD_PROJECT env var\n3. Restart aery",
						"info"
					);
				}
				return;
			}

			// ── Mistral ───────────────────────────────────────────────────
			if (choice.startsWith("Mistral")) {
				const apiKey = await ctx.ui.input("Mistral API key:", "...");
				if (apiKey === undefined) return;
				if (!apiKey.trim() || apiKey === "...") { ctx.ui.notify("API key required", "warning"); return; }
				const modelId = await ctx.ui.input("Model:", "devstral-latest");
				if (!modelId) return;
				addProviderModel("mistral", "https://api.mistral.ai/v1", apiKey, modelId);
				saveProfile("mistral", "mistral", modelId);
				ctx.ui.notify(`Saved Mistral profile: ${modelId}. Switching now...`, "info");
				return;
			}

			// ── Codex ─────────────────────────────────────────────────────
			if (choice.startsWith("Codex")) {
				ctx.ui.notify(
					"Codex setup:\n" +
					"Option 1: Set OPENAI_API_KEY environment variable\n" +
					"Option 2: Run /login to authenticate with OAuth\n\n" +
					"Then restart aery.",
					"info"
				);
				return;
			}

			// ── Added providers ──────────────────────────────────────────
			if (choice.includes("Added providers")) {
				if (!d.profiles.length) { ctx.ui.notify("No added providers yet", "info"); return; }
				const options2 = d.profiles.map(p => `${p.name === d.active ? "▶ " : "  "}${p.name}  (${p.modelId})`);
				const pick = await ctx.ui.select("Added providers — select to switch:", options2);
				if (!pick) return;
				const profileName = pick.replace(/^[▶ ]+/, "").split("  ")[0].trim();
				const profile = d.profiles.find(p => p.name === profileName);
				if (!profile) return;
				const model = ctx.modelRegistry.find(profile.provider, profile.modelId);
				if (!model) { ctx.ui.notify(`Model not found. Restart aery after adding new providers.`, "warning"); return; }
				const ok = await aery.setModel(model);
				if (ok) {
					autoEnabled = false;
					d.active = profileName;
					saveProfiles(d);
					ctx.ui.notify(`Switched to '${profileName}': ${profile.modelId}`, "info");
				} else {
					ctx.ui.notify(`No API key for ${profile.provider}`, "error");
				}
				return;
			}

			// ── Delete provider ───────────────────────────────────────────
			if (choice.includes("Delete provider")) {
				if (!d.profiles.length) { ctx.ui.notify("No saved providers", "info"); return; }
				const toDelete = await ctx.ui.select(
					"Delete which provider?",
					d.profiles.map(p => `${p.name}  (${p.modelId})`)
				);
				if (!toDelete) return;
				const name = toDelete.split("  ")[0].trim();
				deleteProfile(name);
				ctx.ui.notify(`Deleted provider '${name}'`, "info");
				return;
			}
		},
	});
}
