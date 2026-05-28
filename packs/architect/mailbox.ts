import { EventEmitter } from "node:events";

export interface MailboxMessage {
	id: string;
	from: string;
	type: "notification" | "permission_request";
	content: string;
	toolName?: string;
	toolArgs?: any;
	timestamp: number;
	resolved?: boolean;
	approved?: boolean;
}

/**
 * OpenClaude-style Inter-Agent Mailbox.
 * Teammates use this to safely push notifications and destructive permission
 * requests up to the UI/Leader without crashing.
 */
export class Mailbox extends EventEmitter {
	private messages: MailboxMessage[] = [];

	public sendNotification(from: string, content: string) {
		const msg: MailboxMessage = {
			id: Math.random().toString(36).substring(7),
			from,
			type: "notification",
			content,
			timestamp: Date.now()
		};
		this.messages.push(msg);
		this.emit("new_message", msg);
	}

	/**
	 * Pauses the teammate's execution until the Leader/Human approves 
	 * the destructive action via the UI.
	 */
	public async requestPermission(from: string, toolName: string, toolArgs: any, reason: string): Promise<boolean> {
		const msg: MailboxMessage = {
			id: Math.random().toString(36).substring(7),
			from,
			type: "permission_request",
			content: reason,
			toolName,
			toolArgs,
			timestamp: Date.now(),
			resolved: false
		};
		this.messages.push(msg);
		this.emit("permission_requested", msg);

		// Pause the subagent thread until this specific message is resolved
		return new Promise((resolve) => {
			const checkLoop = setInterval(() => {
				if (msg.resolved) {
					clearInterval(checkLoop);
					resolve(msg.approved ?? false);
				}
			}, 500); // Poll every 500ms (OpenClaude style)
		});
	}

	public resolvePermission(messageId: string, approved: boolean) {
		const msg = this.messages.find(m => m.id === messageId);
		if (msg && !msg.resolved) {
			msg.approved = approved;
			msg.resolved = true;
		}
	}

	public getPendingPermissions(): MailboxMessage[] {
		return this.messages.filter(m => m.type === "permission_request" && !m.resolved);
	}
}

// Global mailbox for the Architect Session
export const globalMailbox = new Mailbox();
