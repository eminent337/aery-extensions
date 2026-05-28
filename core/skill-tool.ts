/**
 * Skill Tool — Execute skills (slash commands) programmatically.
 * Supports model override, fork execution, and effort level settings.
 */

import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";

const SkillParams = Type.Object({
	name: Type.Optional(Type.String({
		description: "The skill name (Aery-native)",
	})),
	skill: Type.Optional(Type.String({
		description: "The skill name (Aery Agent compatible)",
	})),
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
});

export function registerSkillTool(aery: ExtensionAPI): void {
	const skillTool: ToolDefinition<typeof SkillParams> = {
		name: "Skill",
		description:
			"Execute a skill (slash command) programmatically. Skills are reusable prompt templates that can override models, restrict tools, and set effort levels.",
		promptSnippet: "invoke a skill or slash command",
		promptGuidelines: [
			"Use skill to invoke slash commands like /commit, /review, /test",
			"Skills can override the model for specialized tasks",
			"Use context:'fork' to run in an isolated sub-agent with its own token budget",
			"Check available skills with the tool_search or by looking at registered commands",
		],
		parameters: SkillParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const skillName = params.skill ?? params.name;
			if (!skillName) {
				return {
					content: [{ type: "text" as const, text: "Skill name is required. Use `skill` or `name`." }],
					isError: true,
				};
			}

			// Get available commands
			const commands = aery.getCommands();
			const cmd = commands.find(
				(c) =>
					c.name.toLowerCase() === skillName.toLowerCase(),
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
							text: `Skill not found: ${skillName}\nAvailable skills: ${available}`,
						},
					],
					isError: true,
				};
			}

			// Set model if override requested
			if (params.model) {
				const success = await aery.setModel(params.model);
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
				aery.setThinkingLevel(levelMap[params.effort]);
			}

			// Send the skill as a user message
			const skillPrompt = `/${skillName}${params.args ? ` ${params.args}` : ""}`;
			aery.sendUserMessage(skillPrompt);

			return {
				content: [
					{
						type: "text" as const,
						text: `Invoked skill: ${skillPrompt}`,
					},
				],
				details: {
					skill: skillName,
					args: params.args,
					model: params.model,
					effort: params.effort,
				},
			};
		},
	};

	aery.registerTool(skillTool);
	aery.registerTool({ ...skillTool, name: "skill", label: "skill" });
}
