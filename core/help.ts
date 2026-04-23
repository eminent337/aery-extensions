/**
 * Aery /help command
 * Lists all registered commands with descriptions.
 */

import type { ExtensionAPI } from "@eminent337/aery";

export default function (aery: ExtensionAPI) {
	aery.registerCommand("help", {
		description: "List all available commands",
		handler: async (_args, ctx) => {
			const commands = aery.getCommands();

			const lines: string[] = [
				"## Available Commands\n",
			];

			for (const cmd of commands.sort((a, b) => a.name.localeCompare(b.name))) {
				lines.push(`- **/${cmd.name}** — ${cmd.description || "no description"}`);
			}

			lines.push("\n---");
			lines.push("_Type `/marketplace` to install more extension packs._");

			aery.sendUserMessage(lines.join("\n"));
		},
	});
}
