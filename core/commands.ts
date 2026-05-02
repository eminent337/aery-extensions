/**
 * Aery Slash Commands — essential git workflow and utility commands
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@eminent337/aery";

export default function (aery: ExtensionAPI) {

	// /commit — AI-assisted git commit
	aery.registerCommand("commit", {
		description: "Stage changes and commit with an AI-generated message",
		handler: async (args, _ctx) => {
			const { stdout: status } = await aery.exec("git", ["status", "--short"]).catch(() => ({ stdout: "" }));
			if (!status.trim()) { aery.sendUserMessage("Nothing to commit — working tree is clean."); return; }
			aery.sendUserMessage(
				`Git status:\n${status}\n\nStage only the relevant files (never git add -A) and write a concise conventional commit message.\n` +
				`${args ? `Context: ${args}\n` : ""}Never use --no-verify.`
			);
		},
	});

	// /commit-push-pr
	aery.registerCommand("commit-push-pr", {
		description: "Commit, push, and create a GitHub PR",
		handler: async (args, _ctx) => {
			const { stdout: branch } = await aery.exec("git", ["branch", "--show-current"]).catch(() => ({ stdout: "unknown" }));
			aery.sendUserMessage(
				`Branch: ${branch.trim()}\n\n1. Stage relevant files (never git add -A)\n2. Commit with a good message\n3. git push origin\n4. gh pr create\n` +
				`${args ? `PR hint: ${args}` : ""}`
			);
		},
	});

	// /branch
	aery.registerCommand("branch", {
		description: "Create a new git branch",
		handler: async (args, _ctx) => {
			const { stdout: current } = await aery.exec("git", ["branch", "--show-current"]).catch(() => ({ stdout: "unknown" }));
			aery.sendUserMessage(
				`Current branch: ${current.trim()}\n\nCreate a new git branch${args ? ` for: ${args}` : ""}. Use kebab-case. Run: git checkout -b <name>`
			);
		},
	});

	// /review
	aery.registerCommand("review", {
		description: "Code review on current changes or a PR",
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
			const { stdout: status } = await aery.exec("git", ["status", "--short"]).catch(() => ({ stdout: "" }));
			if (!status.trim()) { ctx.ui.notify("No uncommitted changes", "info"); return; }
			const { stdout: diff } = await aery.exec("git", ["diff", "--stat", "HEAD"]).catch(() => ({ stdout: "" }));
			ctx.ui.notify(`Changes:\n${status}\n\n${diff}`, "info");
		},
	});

	// /effort — set thinking level
	aery.registerCommand("effort", {
		description: "Set reasoning effort: off | minimal | low | medium | high | xhigh",
		handler: async (args, ctx) => {
			const level = (args?.trim() || "medium") as any;
			const valid = ["off", "minimal", "low", "medium", "high", "xhigh"];
			if (!valid.includes(level)) { ctx.ui.notify(`Valid levels: ${valid.join(", ")}`, "warning"); return; }
			aery.setThinkingLevel(level);
			ctx.ui.notify(`Thinking level: ${level}`, "info");
		},
	});

	// /copy — copy last assistant response to clipboard
	aery.registerCommand("clip", {
		description: "Copy last assistant response to clipboard (/clip)",
		handler: async (_args, ctx) => {
			const entries = ctx.sessionManager.getBranch().filter(e => e.type === "message");
			const last = [...entries].reverse().find(e => (e as any).message?.role === "assistant");
			if (!last) { ctx.ui.notify("No assistant response to copy", "warning"); return; }
			const m = (last as any).message;
			const text = Array.isArray(m.content)
				? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
				: m.content ?? "";
			try {
				await aery.exec("bash", ["-c", `echo ${JSON.stringify(text)} | xclip -selection clipboard 2>/dev/null || echo ${JSON.stringify(text)} | xsel --clipboard 2>/dev/null || echo ${JSON.stringify(text)} | pbcopy 2>/dev/null`]);
				ctx.ui.notify("Copied to clipboard", "info");
			} catch { ctx.ui.notify("Clipboard not available", "warning"); }
		},
	});

	// /doctor — diagnose installation
	aery.registerCommand("doctor", {
		description: "Diagnose aery installation",
		handler: async (_args, ctx) => {
			const checks: [string, string][] = [];
			const check = async (label: string, cmd: string, args: string[]) => {
				try {
					const r = await aery.exec(cmd, args);
					checks.push([label, r.stdout.trim().split("\n")[0]]);
				} catch {
					checks.push([label, "not found"]);
				}
			};
			await check("node", "node", ["--version"]);
			await check("git", "git", ["--version"]);
			await check("gh CLI", "which", ["gh"]);
			checks.push(["~/.aery/agent/", existsSync(join(homedir(), ".aery", "agent")) ? "exists" : "missing"]);
			checks.push(["auth.json", existsSync(join(homedir(), ".aery", "agent", "auth.json")) ? "exists" : "missing"]);
			ctx.ui.notify(checks.map(([k, v]) => `${k}: ${v}`).join("\n"), "info");
		},
	});
}
