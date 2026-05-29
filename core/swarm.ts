import type { ExtensionAPI } from "@aryee337/aery";

// A rudimentary in-memory Swarm registry for Aery agents
const swarmMembers: Set<string> = new Set();
const swarmMessages: Array<{ sender: string; content: string; timestamp: number }> = [];

export default function swarmExtension(aery: ExtensionAPI) {
    aery.registerTool({
        name: "swarm_join",
        description: "Join the active Swarm channel to participate in decentralized peer-to-peer agent collaboration.",
        parameters: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "Your unique agent identifier or role name." }
            },
            required: ["agentId"]
        },
        async execute(_id, args) {
            const agentId = (args as any).agentId;
            swarmMembers.add(agentId);
            return { content: [{ type: "text", text: `Agent ${agentId} successfully joined the swarm. Current members: ${Array.from(swarmMembers).join(", ")}` }] };
        }
    });

    aery.registerTool({
        name: "swarm_broadcast",
        description: "Send a message to all agents currently in the Swarm.",
        parameters: {
            type: "object",
            properties: {
                senderId: { type: "string", description: "Your agent identifier." },
                message: { type: "string", description: "The message or task to broadcast to the swarm." }
            },
            required: ["senderId", "message"]
        },
        async execute(_id, args) {
            const { senderId, message } = args as any;
            if (!swarmMembers.has(senderId)) {
                throw new Error(`Agent ${senderId} has not joined the swarm. Use swarm_join first.`);
            }

            swarmMessages.push({ sender: senderId, content: message, timestamp: Date.now() });

            // In a real implementation, we would emit events to awake background agents.
            // For now, it functions as a shared bulletin board.
            return { content: [{ type: "text", text: `Broadcast sent to ${swarmMembers.size} peers.` }] };
        }
    });

    aery.registerTool({
        name: "swarm_read",
        description: "Read recent messages from the Swarm channel.",
        parameters: { type: "object", properties: {} },
        async execute(_id, _args) {
            if (swarmMessages.length === 0) {
                return { content: [{ type: "text", text: "The swarm channel is currently empty." }] };
            }
            
            const transcript = swarmMessages
                .map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.sender}: ${m.content}`)
                .join("\n");
                
            return { content: [{ type: "text", text: `--- SWARM CHANNEL ---\n${transcript}` }] };
        }
    });
}
