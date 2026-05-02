/**
 * Aery User Model
 * Persists user preferences across sessions (TypeScript vs JS, bun vs npm, etc.)
 * Injects preferences into system context on session start.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const MODEL_PATH = join(homedir(), ".aery", "agent", "user-model.json");

interface UserModel {
	preferences: Record<string, string>;
	updatedAt: number;
}

function load(): UserModel {
	if (!existsSync(MODEL_PATH)) return { preferences: {}, updatedAt: Date.now() };
	try { return JSON.parse(readFileSync(MODEL_PATH, "utf-8")); }
	catch { return { preferences: {}, updatedAt: Date.now() }; }
}

function save(model: UserModel) {
	const dir = join(homedir(), ".aery", "agent");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2));
}

// Auto-detect preferences from project files
function detectFromProject(cwd: string): Record<string, string> {
	const detected: Record<string, string> = {};

	if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
		detected.package_manager = "bun";
	} else if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
		detected.package_manager = "pnpm";
	} else if (existsSync(join(cwd, "yarn.lock"))) {
		detected.package_manager = "yarn";
	} else if (existsSync(join(cwd, "package-lock.json"))) {
		detected.package_manager = "npm";
	}

	if (existsSync(join(cwd, "tsconfig.json"))) {
		detected.language = "TypeScript";
	} else if (existsSync(join(cwd, "package.json"))) {
		detected.language = "JavaScript";
	}

	if (existsSync(join(cwd, "Cargo.toml"))) detected.language = "Rust";
	if (existsSync(join(cwd, "go.mod"))) detected.language = "Go";
	if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) detected.language = "Python";

	return detected;
}

export default function (aery: ExtensionAPI) {
	aery.on("session_start", async (_event, ctx) => {
		const model = load();
		const detected = detectFromProject(process.cwd());

		// Merge detected into model (don't overwrite manual preferences)
		let changed = false;
		for (const [k, v] of Object.entries(detected)) {
			if (!model.preferences[k]) {
				model.preferences[k] = v;
				changed = true;
			}
		}
		if (changed) save(model);


	});

	aery.registerCommand("pref", {
		description: "Set/get user preferences: /pref set <key> <value> | /pref list | /pref clear",
		handler: async (args, ctx) => {
			const model = load();

			if (!args || args === "list") {
				if (Object.keys(model.preferences).length === 0) {
					ctx.ui.notify("No preferences set", "info");
					return;
				}
				const list = Object.entries(model.preferences).map(([k, v]) => `${k}: ${v}`).join("\n");
				aery.sendUserMessage(`User preferences:\n\n${list}`);
				return;
			}

			if (args === "clear") {
				model.preferences = {};
				save(model);
				ctx.ui.notify("Preferences cleared", "info");
				return;
			}

			const parts = args.split(" ");
			if (parts[0] === "set" && parts.length >= 3) {
				const key = parts[1];
				const value = parts.slice(2).join(" ");
				model.preferences[key] = value;
				model.updatedAt = Date.now();
				save(model);
				ctx.ui.notify(`Preference set: ${key} = ${value}`, "info");
				return;
			}

			ctx.ui.notify("Usage: /pref set <key> <value> | /pref list | /pref clear", "error");
		},
	});
}
