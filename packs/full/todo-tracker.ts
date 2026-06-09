import type { ExtensionAPI, ToolDefinition } from "@aryee337/aery";
import { Type } from "typebox";

// Todo Tracking Tool — maintains an ordered step-by-step plan
// Inspired by Codebuff's write_todos

const TodoUpdateParams = Type.Object({
	todos: Type.Array(Type.Object({
		task: Type.String({
			description: "Description of the task."
		}),
		completed: Type.Boolean({
			description: "Whether the task has been completed."
		})
	}), {
		description: "Full ordered list of all tasks with their completion status. Rewrite ALL tasks each time this tool is called."
	})
});

const TodoListParams = Type.Object({});

export function registerTodoTrackerTool(aery: ExtensionAPI) {
	let todos: { task: string; completed: boolean }[] = [];

	const updateTool: ToolDefinition<typeof TodoUpdateParams, { todos: { task: string; completed: boolean }[] }> = {
		name: "TodoUpdate",
		label: "Update Todo List",
		description: "Maintain an ordered step-by-step plan of tasks. Call this to write or update the todo list with ALL current tasks and their completion status. This is used to track progress during multi-step implementations.",
		parameters: TodoUpdateParams,
		async execute(_id, params) {
			todos = params.todos.map(t => ({ ...t }));

			const total = todos.length;
			const done = todos.filter(t => t.completed).length;
			const remaining = total - done;

			let output = `📋 Todo List — ${done}/${total} complete (${remaining} remaining)\n\n`;
			for (let i = 0; i < todos.length; i++) {
				const t = todos[i];
				const checkbox = t.completed ? "✅" : "⬜";
				output += `${checkbox} ${i + 1}. ${t.task}\n`;
			}

			if (remaining === 0 && total > 0) {
				output += "\n🎉 All tasks complete!";
			}

			return {
				content: [{ type: "text", text: output }],
			};
		}
	};

	const listTool: ToolDefinition<typeof TodoListParams, {}> = {
		name: "TodoList",
		label: "List Todos",
		description: "Retrieve the current todo list to see what tasks have been completed and what remains.",
		parameters: TodoListParams,
		async execute() {
			if (todos.length === 0) {
				return {
					content: [{ type: "text", text: "No todo list has been created yet. Use TodoUpdate to start tracking tasks." }],
				};
			}

			const total = todos.length;
			const done = todos.filter(t => t.completed).length;
			const remaining = total - done;

			let output = `📋 Todo List — ${done}/${total} complete (${remaining} remaining)\n\n`;
			for (let i = 0; i < todos.length; i++) {
				const t = todos[i];
				const checkbox = t.completed ? "✅" : "⬜";
				output += `${checkbox} ${i + 1}. ${t.task}\n`;
			}

			return {
				content: [{ type: "text", text: output }],
			};
		}
	};

	aery.registerTool(updateTool);
	aery.registerTool(listTool);
}
