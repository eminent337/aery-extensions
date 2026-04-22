import type { ExtensionAPI } from "@eminent337/aery";
import { VERSION } from "@eminent337/aery";
import { truncateToWidth } from "@eminent337/aery-tui";

const LOGO = [
	"  ▄▄▄   ▄▄▄ ▄▄▄ ▄  ▄",
	" ▐█▀█▌ ▐█▀  █▀▄ ▀▄▄▀",
	" ▐█▄█▌ ▐█▄▄ █▀▄  ██ ",
];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setHeader((_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const lines: string[] = [];

				// Logo lines in sky blue
				for (const line of LOGO) {
					lines.push(truncateToWidth(theme.fg("accent", line), width));
				}

				// Version line
				lines.push(
					truncateToWidth(
						theme.fg("dim", "  AI coding agent · ") +
						theme.fg("muted", `v${VERSION}`),
						width
					)
				);

				// Separator
				lines.push(theme.fg("borderMuted", "─".repeat(width)));

				return lines;
			},
		}));
	});
}
