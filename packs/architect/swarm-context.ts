import { AsyncLocalStorage } from "node:async_hooks";

export interface TeammateState {
	id: string;
	role: "planner" | "implementer" | "reviewer";
	history: string[];
}

/**
 * OpenClaude-style Context Isolation.
 * By using AsyncLocalStorage, multiple teammates can run in the exact same 
 * memory space (sharing the File State Cache) without their conversation 
 * states bleeding into each other.
 */
export const swarmContext = new AsyncLocalStorage<TeammateState>();

export function getTeammateContext(): TeammateState | undefined {
	return swarmContext.getStore();
}

export function runWithTeammateContext<T>(state: TeammateState, callback: () => Promise<T>): Promise<T> {
	return swarmContext.run(state, callback);
}
