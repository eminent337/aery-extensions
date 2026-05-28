/**
 * Ask User Question Tool — Interactive multiple-choice questions with previews.
 */

import type { ExtensionAPI } from "@aryee337/aery";
import { registerToolAliases } from "./tool-aliases.js";
import { Type } from "typebox";

export function registerAskUserQuestionTool(aery: ExtensionAPI): void {
	aery.registerTool({
		name: "ask_user_question",
		description:
			"Ask the user a question with multiple-choice options. Use when you need user input to make a decision or clarify requirements.",
		promptSnippet: "ask the user a clarifying question",
		promptGuidelines: [
			"Use ask_user_question when you need the user to choose between options",
			"Provide clear, concise option labels with helpful descriptions",
			"Use multiSelect:true when multiple options can be selected",
			"Always include an 'Other' option for custom input",
			"Use previews to show code snippets or diagrams when comparing approaches",
		],
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					header: Type.String({
						description: "Very short label (max 12 chars)",
					}),
					question: Type.String({
						description: "The full question to ask",
					}),
					options: Type.Array(
						Type.Object({
							label: Type.String({
								description: "Short display text (1-5 words)",
							}),
							description: Type.String({
								description: "Explanation of what this option means",
							}),
							preview: Type.Optional(
								Type.String({
									description:
										"Optional preview content (code, diagram, etc.)",
								}),
							),
						}),
						{ minItems: 2, maxItems: 4 },
					),
					multiSelect: Type.Optional(
						Type.Boolean({
							description:
								"Allow selecting multiple options. Default: false",
						}),
					),
				}),
				{ minItems: 1, maxItems: 4 },
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Cannot ask questions in non-interactive mode. Proceeding with default assumptions.",
						},
					],
				};
			}

			const answers: Record<string, string> = {};

			for (const q of params.questions) {
				const options = q.options.map((o) => ({
					label: o.label,
					description: o.description,
					preview: o.preview,
				}));

				if (q.multiSelect) {
					// For multi-select, show each option as a separate confirm
					const selected: string[] = [];
					for (const opt of options) {
						const confirmed = await ctx.ui.confirm(
							q.question,
							`Select: ${opt.label} — ${opt.description}`,
						);
						if (confirmed) selected.push(opt.label);
					}
					answers[q.question] = selected.join(", ") || "none selected";
				} else {
					const choice = await ctx.ui.select(
						q.question,
						options.map((o) => ({
							label: o.label,
							description: o.description,
						})),
					);
					answers[q.question] = choice ?? "no selection";
				}
			}

			const formatted = Object.entries(answers)
				.map(([q, a]) => `Q: ${q}\nA: ${a}`)
				.join("\n\n");

			return {
				content: [
					{
						type: "text" as const,
						text: `User responses:\n\n${formatted}`,
					},
				],
			};
		},
	});
	registerToolAliases(aery, { ask_user_question: "AskUserQuestion" });
}
