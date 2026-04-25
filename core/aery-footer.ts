import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AssistantMessage } from "@eminent337/aery-ai";
import type { ExtensionAPI } from "@eminent337/aery";
import { truncateToWidth, visibleWidth } from "@eminent337/aery-tui";

function getActiveModelShort(ctx: any): string {
	// Check if auto-router is active
	try {
		const profiles = JSON.parse(readFileSync(join(homedir(), ".aery", "agent", "profiles.json"), "utf-8"));
		if (profiles.active === "auto") return "auto-router";
	} catch {}
	// Fall back to ctx.model
	const model = ctx?.model;
	if (model) return model.id.split("/").pop() ?? model.id;
	// Legacy fallback
	try {
		const d = JSON.parse(readFileSync(join(homedir(), ".aery.json"), "utf-8"));
		const active = d.providerProfiles?.find((p: any) => p.id === d.activeProviderProfileId);
		const modelId = active?.model ?? active?.modelId ?? "";
		return modelId.split("/").pop() ?? modelId;
	} catch { return "—"; }
}

export default function (aery: ExtensionAPI) {
	aery.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		let cachedCost = 0;
		let cachedTokens = 0;

		aery.on("turn_end", async () => {
			let cost = 0, tokens = 0;
			for (const e of ctx.sessionManager.getBranch()) {
				if (e.type === "message" && (e as any).message?.role === "assistant") {
					const m = (e as any).message as AssistantMessage;
					cost += m.usage?.cost?.total ?? 0;
					tokens += (m.usage?.input ?? 0) + (m.usage?.output ?? 0);
				}
			}
			cachedCost = cost;
			cachedTokens = tokens;
		});

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const model = ctx.model;
					const modelShort = getActiveModelShort(ctx);
					const contextUsage = ctx.getContextUsage?.();
					const pct = contextUsage?.percent != null ? Math.round(contextUsage.percent) : 0;
					const hasContext = contextUsage?.percent != null;

					const branch = footerData.getGitBranch();
					const costStr = cachedCost > 0 ? ` $${cachedCost.toFixed(3)}` : "";

					const left = theme.fg("dim", "─") +
						(branch ? theme.fg("accent", ` ${branch}`) : "") +
						(costStr ? theme.fg("dim", costStr) : "") +
						theme.fg("dim", "  ") +
						theme.fg("accent", "aery") +
						theme.fg("dim", " · ") +
						theme.fg("muted", modelShort) +
						(hasContext
							? theme.fg("dim", "  ") + theme.fg(pct > 80 ? "warning" : "dim", `◕ ${pct}%`)
							: "");

					const right = theme.fg("dim", "^C abort  /help");

					const lw = visibleWidth(left);
					const rw = visibleWidth(right);
					const pad = Math.max(1, width - lw - rw - 1);

					return [truncateToWidth(left + " ".repeat(pad) + right, width - 1)];
				},
			};
		});
	});
}
