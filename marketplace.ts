/**
 * Aery Marketplace
 * /marketplace — browse and install extension packs from github.com/eminent337/aery-extensions
 */

import type { ExtensionAPI } from "@eminent337/aery";

const REGISTRY_URL = "https://raw.githubusercontent.com/eminent337/aery-extensions/main/registry.json";

interface Pack {
	description: string;
	source: string;
	install?: string;
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

export default function (aery: ExtensionAPI) {
	aery.registerCommand("marketplace", {
		description: "Browse and install Aery extension packs",
		handler: async (args, ctx) => {
			ctx.ui.notify("Fetching extension registry...", "info");

			const registry = await fetchRegistry();
			if (!registry) {
				ctx.ui.notify("Failed to fetch registry. Check your connection.", "error");
				return;
			}

			const packs = Object.entries(registry.packs).filter(([, p]) => !p.auto);
			const options = packs.map(([name, pack]) => {
				if (pack.coming_soon) return `${name} [coming soon] — ${pack.description}`;
				const tag = pack.type === "skills" ? "[skills]" : pack.type === "bundle" ? "[bundle]" : "[extension]";
				const count = pack.extensions?.length ? ` (${pack.extensions.length})` : "";
				return `${name}${count} ${tag} — ${pack.description}`;
			});
			options.push("─────────────────────────────────────────");
			options.push("List installed packages");

			const choice = await ctx.ui.select("Aery Marketplace — Select a pack to install", options);
			if (!choice) return;

			if (choice.includes("List installed")) {
				const result = await pi.exec("aery", ["list"]);
				aery.sendUserMessage(`Installed packages:\n\n${result.stdout || "None"}`);
				return;
			}

			const packName = choice.split(" ")[0];
			const pack = registry.packs[packName];
			if (!pack) return;

			if (pack.coming_soon) {
				ctx.ui.notify(`${packName} is coming soon! Follow github.com/eminent337/aery-extensions for updates.`, "info");
				return;
			}

			const confirm = await ctx.ui.select(
				`Install "${packName}"?\n${pack.description}`,
				["Yes, install", "Cancel"]
			);
			if (!confirm || confirm === "Cancel") return;

			ctx.ui.notify(`Installing ${packName}...`, "info");
			const installUrl = pack.install || `https://github.com/${pack.source}`;
			const result = await pi.exec("aery", ["install", installUrl]);
			if (result.code === 0) {
				ctx.ui.notify(`✓ ${packName} installed! Restart aery to activate.`, "info");
			} else {
				ctx.ui.notify(`Install failed: ${result.stderr.slice(0, 100)}`, "error");
			}
		},
	});
}
