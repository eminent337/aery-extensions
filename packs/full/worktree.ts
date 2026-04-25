/**
 * Aery Worktree Tool (Phase 1.5)
 * Creates a git worktree and opens a new aery session in it via tmux.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";
import { Type } from "@sinclair/typebox";

function run(cmd: string, cwd?: string): { ok: boolean; out: string; err: string } {
	try {
		const out = execSync(cmd, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		return { ok: true, out: out.trim(), err: "" };
	} catch (e: any) {
		return { ok: false, out: "", err: (e.stderr?.toString() ?? e.message).trim() };
	}
}

export default function (aery: ExtensionAPI) {
	aery.registerTool({
		name: "enter_worktree",
		description: "Create an isolated git worktree and open a new aery session in it via tmux. Use for parallel feature development.",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Branch/worktree name (auto-generated if omitted)" })),
		}),
		async execute(_id, params, signal, onUpdate) {
			const cwd = process.cwd();

			// Check git
			const gitRoot = run("git rev-parse --show-toplevel", cwd);
			if (!gitRoot.ok) return { content: [{ type: "text" as const, text: `Not a git repository. Run aery from inside a project directory (current: ${cwd}).` }], details: {} };

			const root = gitRoot.out;
			const name = params.name ?? `wt-${Date.now().toString(36)}`;
			const worktreePath = join(dirname(root), name);

			onUpdate?.({ type: "text", text: `Creating worktree '${name}'...` });

			// Create worktree
			const create = run(`git worktree add -b "${name}" "${worktreePath}"`, root);
			if (!create.ok) {
				// Branch may already exist — try without -b
				const create2 = run(`git worktree add "${worktreePath}" "${name}"`, root);
				if (!create2.ok) return { content: [{ type: "text" as const, text: `Failed: ${create2.err}` }], details: {} };
			}

			// Copy .aery/ config if it exists
			const aeryConfig = join(root, ".aery");
			if (existsSync(aeryConfig)) {
				try { cpSync(aeryConfig, join(worktreePath, ".aery"), { recursive: true }); } catch {}
			}

			// Open in tmux if available
			const hasTmux = run("which tmux").ok;
			if (hasTmux) {
				onUpdate?.({ type: "text", text: `Opening tmux window for '${name}'...` });
				run(`tmux new-window -c "${worktreePath}" -n "${name}" "aery"`);
				return {
					content: [{ type: "text" as const, text: `Worktree '${name}' created at ${worktreePath}\nOpened in new tmux window '${name}'.` }],
					details: { path: worktreePath, branch: name },
				};
			}

			return {
				content: [{ type: "text" as const, text: `Worktree '${name}' created at ${worktreePath}\nRun: cd ${worktreePath} && aery` }],
				details: { path: worktreePath, branch: name },
			};
		},
	});

	aery.registerTool({
		name: "exit_worktree",
		description: "Remove the current git worktree and its branch. Warns if there are uncommitted changes.",
		parameters: Type.Object({
			force: Type.Optional(Type.Boolean({ description: "Force removal even with uncommitted changes" })),
		}),
		async execute(_id, params, _signal, onUpdate) {
			const cwd = process.cwd();
			const gitRoot = run("git rev-parse --show-toplevel", cwd);
			if (!gitRoot.ok) return { content: [{ type: "text" as const, text: `Not a git repository. Run aery from inside a project directory (current: ${cwd}).` }], details: {} };

			const root = gitRoot.out;

			// Check for uncommitted changes
			const status = run("git status --porcelain", root);
			if (status.out && !params.force) {
				return {
					content: [{ type: "text" as const, text: `Uncommitted changes detected:\n${status.out}\n\nUse force=true to remove anyway.` }],
					details: {},
				};
			}

			const branch = run("git branch --show-current", root).out;
			onUpdate?.({ type: "text", text: `Removing worktree at ${root}...` });

			// Remove worktree from parent
			const parentRoot = run("git rev-parse --show-toplevel", dirname(root)).out;
			if (parentRoot && parentRoot !== root) {
				run(`git worktree remove "${root}" ${params.force ? "--force" : ""}`, parentRoot);
				run(`git branch -d "${branch}"`, parentRoot);
			}

			return {
				content: [{ type: "text" as const, text: `Worktree removed. Branch '${branch}' deleted.` }],
				details: { path: root, branch },
			};
		},
	});

	// Parallel worktree spawning — spawn multiple aery agents in separate worktrees
	aery.registerTool({
		name: "enter_worktree_parallel",
		description: "Spawn multiple aery --print agents in separate git worktrees for parallel work",
		parameters: Type.Object({
			tasks: Type.Array(Type.String(), { description: "List of prompts, one per worktree" }),
		}),
		async execute(id, params, signal) {
			const results: string[] = [];
			for (let i = 0; i < params.tasks.length; i++) {
				const task = params.tasks[i];
				const name = `wt-${Date.now()}-${i}`;
				await aery.exec("git", ["worktree", "add", "-b", name, `../${name}`], { signal });
				await aery.exec("cp", ["-r", ".aery", `../${name}/.aery`], { signal }).catch(() => {});
				await aery.exec("tmux", ["new-window", "-c", `../${name}`, "-n", name, `aery --print -p "${task.replace(/"/g, '\\"')}"`], { signal });
				results.push(`[${name}] ${task.slice(0, 60)}`);
			}
			return { content: [{ type: "text", text: `Spawned ${params.tasks.length} parallel agents:\n${results.join("\n")}` }] };
		},
	});
}
