/**
 * Aery Multi-Agent Mailbox (Phase 3.2)
 * Worker agents send approval requests, coordinator approves/rejects via /tasks.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@aryee337/aery";
import { Type } from "typebox";

const MAILBOX_DIR = join(homedir(), ".aery", "mailbox");
const PENDING_DIR = join(MAILBOX_DIR, "pending");
const APPROVED_DIR = join(MAILBOX_DIR, "approved");
const REJECTED_DIR = join(MAILBOX_DIR, "rejected");

interface Message {
	id: string;
	from: string;
	action: string;
	details: string;
	timestamp: number;
	claimed?: boolean;
	response?: string;
}

function ensureDirs() {
	[MAILBOX_DIR, PENDING_DIR, APPROVED_DIR, REJECTED_DIR].forEach((dir) => {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	});
}

export default function (aery: ExtensionAPI) {
	ensureDirs();

	aery.registerTool({
		name: "sendMessage",
		description: "Send approval request to coordinator. Returns message ID to poll for response.",
		parameters: Type.Object({
			action: Type.String({ description: "Action requiring approval (e.g., 'delete file', 'deploy')" }),
			details: Type.String({ description: "Details about the action" }),
		}),
		async execute(id, params) {
			const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			const msg: Message = {
				id: msgId,
				from: process.env.AERY_AGENT_NAME || "worker",
				action: params.action,
				details: params.details,
				timestamp: Date.now(),
			};
			writeFileSync(join(PENDING_DIR, `${msgId}.json`), JSON.stringify(msg, null, 2));
			return {
				content: [{ type: "text", text: `Approval request sent (ID: ${msgId}). Poll for response.` }],
			};
		},
	});

	aery.registerTool({
		name: "checkMessage",
		description: "Check if approval request has been approved/rejected. Returns status.",
		parameters: Type.Object({
			messageId: Type.String({ description: "Message ID from sendMessage" }),
		}),
		async execute(id, params) {
			const msgId = params.messageId;
			const approvedFile = join(APPROVED_DIR, `${msgId}.json`);
			const rejectedFile = join(REJECTED_DIR, `${msgId}.json`);

			if (existsSync(approvedFile)) {
				const msg: Message = JSON.parse(readFileSync(approvedFile, "utf-8"));
				return {
					content: [{ type: "text", text: `Approved: ${msg.action}` }],
				};
			}

			if (existsSync(rejectedFile)) {
				const msg: Message = JSON.parse(readFileSync(rejectedFile, "utf-8"));
				return {
					content: [{ type: "text", text: `Rejected: ${msg.action}` }],
				};
			}

			return {
				content: [{ type: "text", text: "Pending — no response yet" }],
			};
		},
	});
}
