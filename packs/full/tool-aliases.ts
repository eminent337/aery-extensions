import type { ExtensionAPI } from "@aryee337/aery";

export function registerToolAliases(aery: ExtensionAPI, aliases: Record<string, string>): void {
	const tools = aery.getAllTools();
	for (const [sourceName, aliasName] of Object.entries(aliases)) {
		const tool = tools.find((candidate) => candidate.name === sourceName);
		if (!tool) continue;
		aery.registerTool({ ...tool, name: aliasName, label: aliasName });
	}
}
