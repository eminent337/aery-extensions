import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "typebox";

type MemoryScope = "user" | "project" | "team";

const MEMORY_DIR = ".aery/memory";
const TEAM_DIR = ".aery/memory/team";
const USER_DIR = join(homedir(), ".aery", "memory");
const INDEX = "MEMORY.md";

function dirForScope(cwd: string, scope: MemoryScope): string {
	if (scope === "user") return USER_DIR;
	return scope === "team" ? join(cwd, TEAM_DIR) : join(cwd, MEMORY_DIR);
}

function ensureMemoryDirs(cwd: string): void {
	for (const dir of [USER_DIR, join(cwd, MEMORY_DIR), join(cwd, TEAM_DIR)]) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}
	for (const index of [join(USER_DIR, INDEX), join(cwd, MEMORY_DIR, INDEX), join(cwd, TEAM_DIR, INDEX)]) {
		if (!existsSync(index)) writeFileSync(index, "", "utf-8");
	}
}

function safeMemoryName(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "memory";
}

function appendMemory(cwd: string, scope: MemoryScope, title: string, body: string): string {
	ensureMemoryDirs(cwd);
	const dir = dirForScope(cwd, scope);
	const safeName = safeMemoryName(title);
	const file = join(dir, `${safeName}.md`);
	writeFileSync(file, body.trim() + "\n", "utf-8");
	const index = join(dir, INDEX);
	const rel = `${safeName}.md`;
	const entry = `- [${title}](${rel}) — ${body.split("\n")[0].slice(0, 100)}\n`;
	const existing = readFileSync(index, "utf-8");
	if (!existing.includes(`](${rel})`)) writeFileSync(index, existing + entry, "utf-8");
	return file;
}

function forgetMemory(cwd: string, scope: MemoryScope, title: string): string | undefined {
	ensureMemoryDirs(cwd);
	const dir = dirForScope(cwd, scope);
	const safeName = safeMemoryName(title);
	const file = join(dir, `${safeName}.md`);
	if (!existsSync(file)) return undefined;
	rmSync(file, { force: true });
	const index = join(dir, INDEX);
	const existing = readFileSync(index, "utf-8");
	const next = existing
		.split("\n")
		.filter((line) => !line.includes(`](${safeName}.md)`))
		.join("\n")
		.trim();
	writeFileSync(index, next ? `${next}\n` : "", "utf-8");
	return file;
}

const MEMORY_PROMPT = `

## Aery Memory Behavior

Aery has user memory at ~/.aery/memory/, project memory at .aery/memory/, and team memory at .aery/memory/team/.

When the user explicitly asks you to remember something, save it immediately with SaveMemory. Use:
- user scope for the current user's private preferences, role, and collaboration style
- project scope for repo/project facts, goals, decisions, and references
- team scope for conventions every contributor should follow

Do not save secrets, credentials, API keys, or sensitive personal data.
Do not save code structure that can be derived by reading the repo.
Before acting on remembered file/function claims, verify current code first.
If the user asks you to forget something, use ForgetMemory to remove or update the relevant memory file and MEMORY.md index.
`;

const MemoryScopeSchema = Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("team")], {
	description: "Memory scope. Default: project",
});

export default function memoryBehaviors(aery: ExtensionAPI): void {
	aery.registerTool({
		name: "SaveMemory",
		description: "Save a user, project, or team memory with an indexed MEMORY.md entry.",
		parameters: Type.Object({
			scope: Type.Optional(MemoryScopeSchema),
			title: Type.String({ description: "Short memory title" }),
			body: Type.String({ description: "Memory content" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const scope = (params.scope ?? "project") as MemoryScope;
			const file = appendMemory(ctx.cwd, scope, params.title, params.body);
			return { content: [{ type: "text" as const, text: `Saved ${scope} memory: ${file}` }] };
		},
	});

	aery.registerTool({
		name: "ForgetMemory",
		description: "Remove a user, project, or team memory and update the MEMORY.md index.",
		parameters: Type.Object({
			scope: Type.Optional(MemoryScopeSchema),
			title: Type.String({ description: "Memory title to forget" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const scope = (params.scope ?? "project") as MemoryScope;
			const file = forgetMemory(ctx.cwd, scope, params.title);
			if (!file) {
				return { content: [{ type: "text" as const, text: `No ${scope} memory found for: ${params.title}` }], isError: true };
			}
			return { content: [{ type: "text" as const, text: `Forgot ${scope} memory: ${file}` }] };
		},
	});

	aery.on("before_agent_start", (event, ctx) => {
		const pieces: string[] = [];
		for (const file of [join(USER_DIR, INDEX), join(ctx.cwd, MEMORY_DIR, INDEX), join(ctx.cwd, TEAM_DIR, INDEX)]) {
			if (existsSync(file)) {
				const content = readFileSync(file, "utf-8").trim();
				if (content) pieces.push(content);
			}
		}
		const existing = event.systemPrompt ?? "";
		if (existing.includes("## Aery Memory Behavior")) return {};
		const memoryContext = pieces.length ? `\n\n## Aery Memory Index\n\n${pieces.join("\n")}` : "";
		return { systemPrompt: existing + MEMORY_PROMPT + memoryContext };
	});
}
