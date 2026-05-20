/**
 * Skill Tool — Execute skills (slash commands) programmatically.
 * Supports model override, fork execution, and effort level settings.
 */

import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

export function registerSkillTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "skill",
		description:
			"Execute a skill (slash command) programmatically. Skills are reusable prompt templates that can override models, restrict tools, and set effort levels.",
		promptSnippet: "invoke a skill or slash command",
		promptGuidelines: [
			"Use skill to invoke slash commands like /commit, /review, /test",
			"Skills can override the model for specialized tasks",
			"Use context:'fork' to run in an isolated sub-agent with its own token budget",
			"Check available skills with the tool_search or by looking at registered commands",
		],
		parameters: Type.Object({
			name: Type.String({
				description:
					"The skill name (e.g., 'commit', 'review', 'test')",
			}),
			args: Type.Optional(
				Type.String({
					description: "Arguments to pass to the skill",
				}),
			),
			model: Type.Optional(
				Type.String({
					description:
						"Override the model for this skill execution (e.g., 'opus', 'haiku', 'sonnet')",
				}),
			),
			effort: Type.Optional(
				Type.Union(
					[
						Type.Literal("low"),
						Type.Literal("medium"),
						Type.Literal("high"),
					],
					{
						description:
							"Effort level for the skill execution",
					},
				),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			// Get available commands
			const commands = pi.getCommands();
			const cmd = commands.find(
				(c) =>
					c.name.toLowerCase() === params.name.toLowerCase(),
			);

			if (!cmd) {
				const available = commands
					.map((c) => c.name)
					.slice(0, 20)
					.join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `Skill not found: ${params.name}\nAvailable skills: ${available}`,
						},
					],
					isError: true,
				};
			}

			// Set model if override requested
			if (params.model) {
				const success = await pi.setModel(params.model);
				if (!success) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to set model: ${params.model}. Check API key availability.`,
							},
						],
						isError: true,
					};
				}
			}

			// Set thinking level if effort specified
			if (params.effort) {
				const levelMap = {
					low: "minimal" as const,
					medium: "medium" as const,
					high: "high" as const,
				};
				pi.setThinkingLevel(levelMap[params.effort]);
			}

			// Send the skill as a user message
			const skillPrompt = `/${params.name}${params.args ? ` ${params.args}` : ""}`;
			pi.sendUserMessage(skillPrompt);

			return {
				content: [
					{
						type: "text" as const,
						text: `Invoked skill: ${skillPrompt}`,
					},
				],
				details: {
					skill: params.name,
					args: params.args,
					model: params.model,
					effort: params.effort,
				},
			};
		},
	});
}
