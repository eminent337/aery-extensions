/**
 * Aery Marketplace
 * /marketplace [install|uninstall] [name] — browse, install, and uninstall extensions
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

const REGISTRY_URL = "https://raw.githubusercontent.com/eminent337/aery-extensions/main/registry.json";
const SETTINGS_PATH = join(homedir(), ".aery", "agent", "settings.json");

interface Pack {
	description: string;
	source: string;
	install?: string;
	file?: string;
	extensions?: string[];
	auto?: boolean;
	coming_soon?: boolean;
	type?: "extension" | "skills" | "bundle";
}

interface Registry {
	version: string;
	packs: Record<string, Pack>;
}

async function fetchRegistry(): Promise<Registry | null> {
	try {
		const res = await fetch(REGISTRY_URL);
		if (!res.ok) return null;
		return await res.json() as Registry;
	} catch {
		return null;
	}
}

function getSettings(): any {
	try { return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")); } catch { return {}; }
}

function saveSettings(s: any) {
	writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

function getInstalledExtensions(): string[] {
	return getSettings().extensions ?? [];
}

function isInstalled(packName: string, pack: Pack): boolean {
	const exts = getInstalledExtensions();
	const pkgs = getSettings().packages ?? [];
	if (pack.file) {
		return exts.some((e: string) => e.includes(pack.file!));
	}
	return pkgs.some((p: string) => p.includes(pack.source));
}

async function installPack(packName: string, pack: Pack, execFn: any, ctx: any): Promise<boolean> {
	const repoDir = join(homedir(), ".aery", "agent", "git", "github.com", pack.source);

	// Clone repo if not already present, otherwise pull latest
	if (!existsSync(repoDir)) {
		const repoUrl = `https://github.com/${pack.source}`;
		const cloneResult = await execFn("git", ["clone", repoUrl, repoDir], { timeout: 60_000 });
		if (cloneResult.exitCode !== 0) {
			ctx.ui.notify(`Clone failed: ${cloneResult.stderr?.slice(0, 100)}`, "error");
			return false;
		}
	} else {
		// Already cloned — pull latest silently
		await execFn("git", ["-C", repoDir, "pull", "--ff-only"], { timeout: 30_000 }).catch(() => {});
	}

	if (pack.file) {
		// Wire specific file
		const filePath = join(repoDir, pack.file);
		if (!existsSync(filePath)) {
			ctx.ui.notify(`File not found: ${filePath}`, "error");
			return false;
		}
		const s = getSettings();
		s.extensions = s.extensions ?? [];
		if (!s.extensions.includes(filePath)) s.extensions.push(filePath);
		saveSettings(s);
		return true;
	} else {
		// Wire whole package
		const s = getSettings();
		s.packages = s.packages ?? [];
		const repoUrl = `https://github.com/${pack.source}`;
		if (!s.packages.includes(repoUrl)) s.packages.push(repoUrl);
		saveSettings(s);
		return true;
	}
}

function uninstallPack(packName: string, pack: Pack, ctx: any): boolean {
	const s = getSettings();
	let removed = false;

	if (pack.file) {
		const filePath = join(homedir(), ".aery", "agent", "git", "github.com", pack.source, pack.file);
		const before = (s.extensions ?? []).length;
		s.extensions = (s.extensions ?? []).filter((e: string) => e !== filePath && !e.includes(pack.file!));
		removed = s.extensions.length < before;
	} else {
		const before = (s.packages ?? []).length;
		s.packages = (s.packages ?? []).filter((p: string) => !p.includes(pack.source));
		removed = s.packages.length < before;
	}

	if (removed) saveSettings(s);
	return removed;
}

export default function (aery: ExtensionAPI) {

	aery.registerCommand("marketplace", {
		description: "Browse, install, or uninstall extensions. Usage: /marketplace [install|uninstall] [name]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0]?.toLowerCase();
			const packArg = parts[1]?.toLowerCase();

			ctx.ui.notify("Fetching extension registry...", "info");
			const registry = await fetchRegistry();
			if (!registry) {
				ctx.ui.notify("Failed to fetch registry. Check your connection.", "error");
				return;
			}

			const availablePacks = Object.entries(registry.packs).filter(([, p]) => !p.auto);

			// /marketplace install [name]
			if (subcommand === "install") {
				let packName = packArg;
				let pack = packName ? registry.packs[packName] : undefined;

				if (!pack) {
					// Show selection if no name given or name not found
					const options = availablePacks
						.filter(([, p]) => !p.coming_soon)
						.map(([name, p]) => {
							const tag = p.type === "skills" ? "[skills]" : p.type === "bundle" ? "[bundle]" : "[ext]";
							const installed = isInstalled(name, p) ? " ✓" : "";
							return `${name} ${tag}${installed} — ${p.description}`;
						});
					const choice = await ctx.ui.select("Select extension to install:", options);
					if (!choice) return;
					packName = choice.split(" ")[0];
					pack = registry.packs[packName];
				}

				if (!pack) { ctx.ui.notify(`Unknown extension: ${packName}`, "error"); return; }
				if (pack.coming_soon) { ctx.ui.notify(`${packName} is coming soon!`, "info"); return; }
				if (isInstalled(packName, pack)) { ctx.ui.notify(`${packName} is already installed.`, "info"); return; }

				ctx.ui.notify(`Installing ${packName}...`, "info");
				const ok = await installPack(packName, pack, aery.exec.bind(aery), ctx);
				if (ok) ctx.ui.notify(`✓ ${packName} installed! Restart Aery to activate.`, "info");
				else ctx.ui.notify(`Install failed.`, "error");

				return;
			}

			// /marketplace uninstall [name]
			if (subcommand === "uninstall" || subcommand === "remove") {
				let packName = packArg;
				let pack = packName ? registry.packs[packName] : undefined;

				if (!pack) {
					// Show only installed extensions
					const installed = availablePacks.filter(([name, p]) => isInstalled(name, p));
					if (installed.length === 0) { ctx.ui.notify("No extensions installed via marketplace.", "info"); return; }
					const options = installed.map(([name, p]) => {
						const tag = p.type === "skills" ? "[skills]" : "[ext]";
						return `${name} ${tag} — ${p.description}`;
					});
					const choice = await ctx.ui.select("Select extension to uninstall:", options);
					if (!choice) return;
					packName = choice.split(" ")[0];
					pack = registry.packs[packName];
				}

				if (!pack) { ctx.ui.notify(`Unknown extension: ${packName}`, "error"); return; }

				const confirm = await ctx.ui.select(`Uninstall "${packName}"?`, ["Yes, uninstall", "Cancel"]);
				if (!confirm || confirm === "Cancel") return;

				const removed = uninstallPack(packName, pack, ctx);
				if (removed) {
					ctx.ui.notify(`✓ ${packName} uninstalled. Restart Aery to apply.`, "info");
				} else {
					ctx.ui.notify(`${packName} was not found in settings.`, "warning");
				}
				return;
			}

			// /marketplace list
			if (subcommand === "list") {
				const installed = availablePacks.filter(([name, p]) => isInstalled(name, p)).map(([name]) => name);
				const msg = installed.length > 0
					? `Installed: ${installed.join(", ")}`
					: "No extensions installed via marketplace.";
				ctx.ui.notify(msg, "info");
				return;
			}

			// /marketplace (no args) — browse
			const options = availablePacks.map(([name, pack]) => {
				if (pack.coming_soon) return `${name} [coming soon] — ${pack.description}`;
				const tag = pack.type === "skills" ? "[skills]" : pack.type === "bundle" ? "[bundle]" : "[ext]";
				const installed = isInstalled(name, pack) ? " ✓" : "";
				return `${name} ${tag}${installed} — ${pack.description}`;
			});
			options.push("─────────────────────────────────────────");
			options.push("List installed");

			const choice = await ctx.ui.select("Aery Marketplace", options);
			if (!choice) return;

			if (choice.includes("List installed")) {
				const installed = availablePacks.filter(([name, p]) => isInstalled(name, p)).map(([name]) => name);
				ctx.ui.notify(installed.length > 0 ? `Installed: ${installed.join(", ")}` : "None installed.", "info");
				return;
			}

			const packName = choice.split(" ")[0];
			const pack = registry.packs[packName];
			if (!pack || pack.coming_soon) return;

			// Toggle install/uninstall
			if (isInstalled(packName, pack)) {
				const confirm = await ctx.ui.select(`"${packName}" is installed. Uninstall?`, ["Yes, uninstall", "Cancel"]);
				if (!confirm || confirm === "Cancel") return;
				const removed = uninstallPack(packName, pack, ctx);
				if (removed) ctx.ui.notify(`✓ ${packName} uninstalled. Restart Aery.`, "info");
				else ctx.ui.notify(`${packName} not found in settings.`, "warning");

			} else {
				const confirm = await ctx.ui.select(`Install "${packName}"?\n${pack.description}`, ["Yes, install", "Cancel"]);
				if (!confirm || confirm === "Cancel") return;
				ctx.ui.notify(`Installing ${packName}...`, "info");
				const ok = await installPack(packName, pack, aery.exec.bind(aery), ctx);
				if (ok) ctx.ui.notify(`✓ ${packName} installed! Restart Aery.`, "info");
			}
		},
	});
}
