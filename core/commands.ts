/**
 * Aery Slash Commands (Phase 1.6) — corrected Pi API usage
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

export default function (aery: ExtensionAPI) {

	// /aery — meta command: status, reload, help
	aery.registerCommand("aery", {
		description: "Aery meta: /aery [status|reload|help]",
		handler: async (args, ctx) => {
			const cmd = args?.trim() || "status";
			if (cmd === "reload") {
				// Trigger full reload
				await ctx.reload();
				ctx.ui.notify("Extensions, skills, and themes reloaded", "info");
			} else if (cmd === "help") {
				ctx.ui.notify(
					"Aery commands:\n" +
					"/init /commit /commit-push-pr /branch /review /diff\n" +
					"/plan /security-review /bughunter /ultraplan\n" +
					"/effort /rename /context /cost /doctor /tasks\n" +
					"/provider /wiki /pr_comments /auto-fix /rewind\n" +
					"/aery-export /aery-copy /aery-model\n\n" +
					"/aery reload — reload all extensions\n" +
					"/aery status — show system status",
					"info"
				);
			} else {
				// status
				const usage = ctx.getContextUsage();
				const model = ctx.model;
				const thinking = pi.getThinkingLevel();
				ctx.ui.notify(
					`Model: ${model ? `${model.provider}/${model.id}` : "none"}\n` +
					`Thinking: ${thinking}\n` +
					`Context: ${usage?.tokens != null ? `${(usage.tokens/1000).toFixed(1)}k / ${(usage.contextWindow/1000).toFixed(0)}k (${usage.percent?.toFixed(1)}%)` : "unknown"}\n\n` +
					`/aery help — show all commands\n/aery reload — reload extensions`,
					"info"
				);
			}
		},
	});


	aery.registerCommand("init", {
		description: "Analyze codebase and generate AGENTS.md",
		handler: async (_args, _ctx) => {
			aery.sendUserMessage(
				`Analyze this codebase and create an AGENTS.md file in the project root.\n\n` +
				`Include:\n1. How to build, test, and run the project\n2. High-level architecture\n3. Key conventions\n\n` +
				`Be concise. Read existing README.md and config files first.`
			);
		},
	});

	// /commit — AI-assisted git commit
	aery.registerCommand("commit", {
		description: "Stage all changes and commit with an AI-generated message (voice: commit changes, save work)",
		handler: async (args, _ctx) => {
			const { stdout: status } = await pi.exec("git", ["status", "--short"]).catch(() => ({ stdout: "" }));
			if (!status.trim()) { aery.sendUserMessage("Nothing to commit — working tree is clean."); return; }
			aery.sendUserMessage(
				`Git status:\n${status}\n\n` +
				`Stage all changes with \`git add -A\` then write a concise commit message and commit.\n` +
				`${args ? `Context: ${args}\n` : ""}` +
				`Follow conventional commits. Never use --no-verify.`
			);
		},
	});

	// /commit-push-pr
	aery.registerCommand("commit-push-pr", {
		description: "Commit, push, and create a GitHub PR",
		handler: async (args, _ctx) => {
			const { stdout: branch } = await pi.exec("git", ["branch", "--show-current"]).catch(() => ({ stdout: "unknown" }));
			aery.sendUserMessage(
				`Branch: ${branch.trim()}\n\n1. git add -A\n2. Commit with a good message\n3. git push origin\n4. gh pr create\n` +
				`${args ? `PR hint: ${args}` : ""}`
			);
		},
	});

	// /branch
	aery.registerCommand("branch", {
		description: "Create a new git branch",
		handler: async (args, _ctx) => {
			const { stdout: current } = await pi.exec("git", ["branch", "--show-current"]).catch(() => ({ stdout: "unknown" }));
			aery.sendUserMessage(
				`Current branch: ${current.trim()}\n\nCreate a new git branch${args ? ` for: ${args}` : ""}.\n` +
				`Use kebab-case. Run: git checkout -b <name>`
			);
		},
	});

	// /review
	aery.registerCommand("review", {
		description: "Run a code review on current changes or a PR (voice: review code, check my work)",
		handler: async (args, _ctx) => {
			aery.sendUserMessage(
				`Run a code review${args ? ` on: ${args}` : " on current uncommitted changes"}.\n\n` +
				`Use \`git diff HEAD\` or \`gh pr diff ${args || ""}\` to get the diff.\n` +
				`Review for: bugs, security issues, error handling, test coverage, code style.`
			);
		},
	});

	// /diff
	aery.registerCommand("diff", {
		description: "Show uncommitted changes",
		handler: async (_args, ctx) => {
			const { stdout: diff } = await pi.exec("git", ["diff", "--stat", "HEAD"]).catch(() => ({ stdout: "" }));
			const { stdout: status } = await pi.exec("git", ["status", "--short"]).catch(() => ({ stdout: "" }));
			if (!status.trim()) { ctx.ui.notify("No uncommitted changes", "info"); return; }
			ctx.ui.notify(`Changes:\n${status}\n\n${diff}`, "info");
		},
	});

	// /aery-export
	aery.registerCommand("aery-export", {
		description: "Export conversation to a text file",
		handler: async (args, ctx) => {
			const filename = args || `aery-session-${Date.now()}.txt`;
			const messages = ctx.sessionManager.getBranch()
				.filter(e => e.type === "message")
				.map(e => {
					const m = (e as any).message;
					const role = m.role === "user" ? "You" : "Aery";
					const text = Array.isArray(m.content)
						? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
						: m.content ?? "";
					return `[${role}]\n${text}`;
				}).join("\n\n---\n\n");
			writeFileSync(filename, messages, "utf-8");
			ctx.ui.notify(`Exported to ${filename}`, "info");
		},
	});

	// /aery-copy
	aery.registerCommand("aery-copy", {
		description: "Copy last assistant response to clipboard",
		handler: async (_args, ctx) => {
			const entries = ctx.sessionManager.getBranch().filter(e => e.type === "message");
			const last = [...entries].reverse().find(e => (e as any).message?.role === "assistant");
			if (!last) { ctx.ui.notify("No assistant response to copy", "warning"); return; }
			const m = (last as any).message;
			const text = Array.isArray(m.content)
				? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
				: m.content ?? "";
			try {
				await pi.exec("bash", ["-c", `echo ${JSON.stringify(text)} | xclip -selection clipboard 2>/dev/null || echo ${JSON.stringify(text)} | xsel --clipboard 2>/dev/null || echo ${JSON.stringify(text)} | pbcopy 2>/dev/null`]);
				ctx.ui.notify("Copied to clipboard", "info");
			} catch { ctx.ui.notify("Clipboard not available", "warning"); }
		},
	});

	// /effort
	aery.registerCommand("effort", {
		description: "Set reasoning effort: off | minimal | low | medium | high | xhigh",
		handler: async (args, ctx) => {
			const level = (args?.trim() || "medium") as any;
			const valid = ["off", "minimal", "low", "medium", "high", "xhigh"];
			if (!valid.includes(level)) { ctx.ui.notify(`Valid levels: ${valid.join(", ")}`, "warning"); return; }
			pi.setThinkingLevel(level);
			ctx.ui.notify(`Thinking level: ${level}`, "info");
		},
	});

	// /rename
	aery.registerCommand("rename", {
		description: "Rename the current session",
		handler: async (args, ctx) => {
			if (!args) { ctx.ui.notify("Usage: /rename <name>", "warning"); return; }
			pi.setSessionName(args.trim());
			ctx.ui.notify(`Session renamed to: ${args.trim()}`, "info");
		},
	});

	// /context
	aery.registerCommand("context", {
		description: "Show context window usage",
		handler: async (_args, ctx) => {
			const usage = ctx.getContextUsage();
			if (!usage || usage.tokens == null) { ctx.ui.notify("Context usage unavailable", "warning"); return; }
			const pct = usage.percent ?? 0;
			const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
			ctx.ui.notify(`[${bar}] ${pct.toFixed(1)}%\n${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens`, "info");
		},
	});

	// /cost
	aery.registerCommand("cost", {
		description: "Show session API cost",
		handler: async (_args, ctx) => {
			let cost = 0, input = 0, output = 0;
			for (const e of ctx.sessionManager.getBranch()) {
				if (e.type === "message" && (e as any).message?.role === "assistant") {
					const u = (e as any).message.usage;
					cost += u?.cost?.total ?? 0;
					input += u?.input ?? 0;
					output += u?.output ?? 0;
				}
			}
			const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
			ctx.ui.notify(`Cost: $${cost.toFixed(4)}\nTokens: ${fmt(input)} in / ${fmt(output)} out`, "info");
		},
	});

	// /plan
	aery.registerCommand("plan", {
		description: "Toggle read-only plan mode",
		handler: async (_args, _ctx) => {
			aery.sendUserMessage(
				`Enter planning mode: analyze the codebase and create a detailed plan.\n` +
				`DO NOT modify any files. Use only read, grep, find, ls tools.\n` +
				`Write the plan to PLAN.md when done.`
			);
		},
	});

	// /security-review
	aery.registerCommand("security-review", {
		description: "Run an AI-assisted security audit (voice: security check, run audit)",
		handler: async (args, _ctx) => {
			aery.sendUserMessage(
				`Perform a security review${args ? ` of: ${args}` : " of the current codebase"}.\n\n` +
				`Check for: injection vulnerabilities, auth issues, secrets in code, insecure deps, input validation gaps.\n` +
				`Be specific with file paths and line numbers.`
			);
		},
	});

	// /doctor
	aery.registerCommand("doctor", {
		description: "Diagnose aery installation",
		handler: async (_args, ctx) => {
			const checks: [string, string][] = [];
			const check = async (label: string, cmd: string, args: string[]) => {
				try {
					const r = await pi.exec(cmd, args);
					checks.push([label, r.stdout.trim().split("\n")[0]]);
				} catch {
					checks.push([label, "❌ not found"]);
				}
			};
			await check("node", "node", ["--version"]);
			await check("git", "git", ["--version"]);
			await check("tmux", "which", ["tmux"]);
			await check("gh CLI", "which", ["gh"]);
			checks.push(["~/.aery/agent/", existsSync(join(homedir(), ".aery", "agent")) ? "✅ exists" : "❌ missing"]);
			checks.push(["models.json", existsSync(join(homedir(), ".aery", "agent", "models.json")) ? "✅ exists" : "❌ missing"]);
			ctx.ui.notify(checks.map(([k, v]) => `${k}: ${v}`).join("\n"), "info");
		},
	});


	// /pr_comments
	aery.registerCommand("pr_comments", {
		description: "Fetch and display PR review comments",
		handler: async (args, _ctx) => {
			aery.sendUserMessage(
				`Fetch PR review comments${args ? ` for PR #${args}` : ""}.\n` +
				`Run: gh pr view ${args || ""} --comments\n` +
				`Summarize the feedback and suggest how to address each comment.`
			);
		},
	});

	// /auto-fix
	aery.registerCommand("auto-fix", {
		description: "Run lint and tests, then fix any errors (voice: fix errors, run tests)",
		handler: async (args, _ctx) => {
			aery.sendUserMessage(
				`Run the project's lint and test commands${args ? ` (${args})` : ""}.\n` +
				`Check package.json scripts for lint/test. Fix all errors. Repeat until clean.`
			);
		},
	});

	// /tasks
	aery.registerCommand("tasks", {
		description: "List running background processes",
		handler: async (_args, ctx) => {
			const { stdout } = await pi.exec("bash", ["-c", "ps aux | grep -E 'node|bun|python' | grep -v grep | grep -v 'ps aux' | head -10"]).catch(() => ({ stdout: "" }));
			ctx.ui.notify(stdout.trim() || "No background tasks found", "info");
		},
	});

	// /wiki
	aery.registerCommand("wiki", {
		description: "Manage project wiki in .aery/wiki/",
		handler: async (args, ctx) => {
			const wikiDir = join(process.cwd(), ".aery", "wiki");
			if (args === "init") {
				mkdirSync(wikiDir, { recursive: true });
				const index = join(wikiDir, "README.md");
				if (!existsSync(index)) writeFileSync(index, `# Project Wiki\n\nAdd documentation here.\n`);
				ctx.ui.notify(`Wiki initialized at ${wikiDir}`, "info");
			} else if (args === "status") {
				ctx.ui.notify(existsSync(wikiDir) ? `Wiki at ${wikiDir}` : "No wiki. Run /wiki init", "info");
			} else {
				aery.sendUserMessage(`Help manage the project wiki in .aery/wiki/. ${args || "List existing wiki files."}`);
			}
		},
	});

	// /bughunter
	aery.registerCommand("bughunter", {
		description: "Enter bug hunting mode",
		handler: async (args, _ctx) => {
			aery.sendUserMessage(
				`Enter bug hunting mode${args ? ` for: ${args}` : ""}.\n\n` +
				`1. Read error logs and stack traces\n2. Reproduce the bug\n3. Identify root cause\n4. Fix minimally\n5. Verify fix\n\n` +
				`Start by checking recent errors and git log.`
			);
		},
	});

	// /rewind
	aery.registerCommand("rewind", {
		description: "Show recent messages to rewind to",
		handler: async (_args, ctx) => {
			const entries = ctx.sessionManager.getBranch()
				.filter(e => e.type === "message" && (e as any).message?.role === "user")
				.slice(-8);
			if (!entries.length) { ctx.ui.notify("No messages to rewind to", "info"); return; }
			const list = entries.map((e, i) => {
				const m = (e as any).message;
				const text = Array.isArray(m.content) ? m.content.find((c: any) => c.type === "text")?.text ?? "" : m.content ?? "";
				return `${i + 1}. [${e.id.slice(0, 8)}] ${text.slice(0, 60)}`;
			}).join("\n");
			ctx.ui.notify(`Recent messages:\n${list}\n\nUse /tree to navigate`, "info");
		},
	});

	// /ultraplan
	aery.registerCommand("ultraplan", {
		description: "Deep planning mode before implementation (voice: plan this, think it through)",
		handler: async (args, _ctx) => {
			aery.sendUserMessage(
				`Ultra-planning mode for: ${args || "the current task"}.\n\n` +
				`Phase 1 — Explore (read-only): map files, understand deps, identify risks.\n` +
				`Phase 2 — Plan: write step-by-step plan to PLAN.md with rollback strategy.\n\n` +
				`DO NOT implement yet. Present the plan for review first.`
			);
		},
	});
}
