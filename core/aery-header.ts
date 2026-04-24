import type { ExtensionAPI } from "@eminent337/aery";
import { VERSION } from "@eminent337/aery";
import { truncateToWidth } from "@eminent337/aery-tui";

const LOGO = [
	"╔═╗╔═╗╦═╗╦ ╦",
	"╠═╣║╣ ╠╦╝╚╦╝",
	"╩ ╩╚═╝╩╚═ ╩ ",
];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setHeader((_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const lines: string[] = [];

				// Logo lines in sky blue, centered
				const logoWidth = 14; // width of the 3-line logo
				for (const line of LOGO) {
					const pad = Math.max(0, Math.floor((width - logoWidth) / 2));
					lines.push(" ".repeat(pad) + theme.fg("accent", line));
				}

				// Version line, centered
				const versionText = `AI coding agent · v${VERSION}`;
				const vpad = Math.max(0, Math.floor((width - versionText.length) / 2));
				lines.push(" ".repeat(vpad) + theme.fg("dim", versionText));

				// Separator
				lines.push(theme.fg("borderMuted", "─".repeat(width)));

				return lines;
			},
		}));
	});
}
