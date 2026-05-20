/**
 * Aery Slash Commands — essential git workflow commands
 */

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
}
