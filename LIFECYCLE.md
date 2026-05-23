# Extension Lifecycle & Interaction Guide

This document covers how core extensions interact with each other through the event system. For the full event reference, see `packages/coding-agent/docs/extensions.md`.

## Event Ordering

```
session_start
  resources_discover
    │
    ▼
  [user sends prompt]
    input
    before_agent_start          ← extensions inject context here
    agent_start
    │
    ├─── turn loop ──────────────────────────────┐
    │   turn_start                                │
    │   context                                   │
    │   before_provider_request                   │
    │   after_provider_response                   │
    │   │                                         │
    │   [LLM responds, may call tools]            │
    │   tool_execution_start                      │
    │   tool_call                                 │
    │   tool_result                               │
    │   tool_execution_end                        │
    │   turn_end                                  │
    └─────────────────────────────────────────────┘
    agent_end
    │
  [next prompt or exit]
    session_shutdown
```

## Core Extension Event Subscriptions

| Extension | Subscribes to | Purpose |
|-----------|--------------|---------|
| agent-enhancements | before_agent_start, tool_result, turn_end, session_start | Cost tracking, tool result compaction, thinking budget |
| agent-routing | before_agent_start, turn_end | Route to different models based on context |
| auto-fix | tool_result, turn_start | Auto-retry failed tool calls |
| circuit-breaker | tool_call (via tool wrapper) | Stop after 3 consecutive failures |
| coordination-enhancements | before_agent_start, session_start, tool_result | Multi-agent coordination context |
| coordinator-mode | before_agent_start, session_shutdown | Inject coordinator orchestration prompt; cleanup coordinator state |
| subagent | (tool-driven) | Registers Agent, SendMessage, background_tasks, kill_background_task; emits task notifications |
| file-history | session_start, tool_call, turn_end | Track file changes per turn |
| graphify | session_start, session_shutdown | Inject knowledge graph context, register graph tools |
| hooks-enhanced | tool_call, tool_result, session_start, session_shutdown, turn_start, turn_end, session_before_compact, session_compact | User-configured automation hooks |
| model-failover | (none — intercepts provider errors) | Retry with fallback models |
| multi-agent | (none — registers tools) | Mailbox-based agent coordination |
| session-auto-name | (none — uses tool_result hook) | Auto-name sessions from first prompt |

## Interaction Patterns

### Pattern 1: Context Injection (before_agent_start)

Multiple extensions inject context in `before_agent_start`. Order matters — later handlers see earlier injections.

```
before_agent_start fires:
  1. agent-enhancements  → injects cost/token budget info
  2. agent-routing       → may switch model
  3. coordination-enhancements → injects team context
```

Safe: Each handler appends to `event.messages`. They don't conflict because they add different message types.

Unsafe: Two handlers both trying to replace the system prompt will clobber each other.

### Pattern 2: Tool Result Interception (tool_result)

Several extensions modify tool results. The event fires after tool execution but before the result is sent to the LLM.

```
tool_result fires:
  1. agent-enhancements  → compacts large extension tool outputs
  2. auto-fix            → may retry failed bash/edit calls
  3. coordination-enhancements → logs results for team coordination
  4. hooks-enhanced      → runs user-configured hooks
```

Safe: Reading/modifying `event.result.content` (compaction, annotation).
Unsafe: Two extensions both trying to replace the result entirely.

### Pattern 3: Tool Wrapping (circuit-breaker)

The circuit breaker wraps tool execution at the `tool_call` level. It counts consecutive failures per tool name and blocks further calls after 3 failures.

Interaction with auto-fix: auto-fix operates on `tool_result` (after execution), while circuit-breaker operates on `tool_call` (before execution). They don't conflict — if auto-fix retries and succeeds, the circuit breaker resets its counter.

### Pattern 4: Session Lifecycle (graphify + lsp + mcp + cron)

These extensions manage resources that span the session lifetime:

```
session_start:
  graphify    → loads graph.json, injects context
  lsp         → initializes language servers
  mcp         → connects to MCP servers (async, non-blocking)
  cron        → starts scheduler

session_shutdown:
  graphify    → (no cleanup needed)
  lsp         → shuts down language servers
  mcp         → disconnects MCP servers
  cron        → stops scheduler
```

Safe: Each manages its own resources independently.
Unsafe: Assuming another extension's resources are ready during `session_start` — MCP connects async, so don't depend on MCP tools being available in the same tick.

### Pattern 5: Model Switching (agent-routing + model-failover)

- `agent-routing` switches models proactively in `before_agent_start` based on context (e.g., route code tasks to Claude, chat to GPT).
- `model-failover` reacts to provider errors by retrying with a different model.

These are complementary: routing picks the initial model, failover handles when that model is down. No conflict.

### Pattern 6: Agent Orchestration (Agent + SendMessage + coordinator-mode)

Aery's `Agent` tool supports the same coordination shape used by advanced agent workflows:

```ts
Agent({
  description: "Search auth flow",
  prompt: "Find where auth state is persisted. Report files and risks.",
  subagent_type: "explore",
  run_in_background: true,
  name: "auth-search"
})
```

Background agents return immediately and continue in a child `aery` process. On completion, they inject a user-role task notification:

```xml
<task-notification>
<task-id>agent-...</task-id>
<status>completed</status>
<summary>Agent "auth-search" (explore) completed</summary>
<result>...</result>
</task-notification>
```

Use `SendMessage` to continue a completed worker by name or task ID. It respawns the same agent with its previous result plus the follow-up prompt.

Aery also exposes Agent-compatible tool names as aliases so imported workflows transfer cleanly:

- `Agent` plus legacy `subagent`
- `Skill` plus legacy `skill`
- `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`
- `TeamCreate`, `TeamTaskList`, `TeamTaskClaim`, `TeamTaskComplete`, `TeamMessage`, `TeamInbox`, `TeamDelete`
- `TaskStop`, `TaskOutput` for background agents
- `AskUserQuestion`, `CronCreate`, `CronDelete`, `CronList`
- `NotebookEdit`, `ToolSearch`, `WebFetch`, `WebSearch`

Coordinator mode (`/coordinator`) injects an orchestration prompt into `before_agent_start`. It teaches the main agent to run: Research → Synthesis → Implementation → Verification → Conclusion.

Safe: read-only research agents can run in parallel.
Unsafe: editing agents touching the same files must be serialized, then verified with the `verification` agent.

## Gotchas

1. **Event handler ordering is insertion order.** Extensions are loaded in filesystem order (`aery-extension.ts` first, then alphabetical). If two extensions both modify the same event payload, the last one wins.

2. **Async handlers are awaited sequentially**, not in parallel. A slow `session_start` handler blocks subsequent handlers.

3. **`tool_result` modification is shared.** If extension A modifies `event.result.content` and extension B reads it, B sees A's modified version. This is intentional but means you can't assume you're seeing the original tool output.

4. **`sendUserMessage` queues a message for the next turn.** It doesn't interrupt the current turn. If you need to abort, use `abortAgent()`.

5. **MCP tools are registered asynchronously.** The `mcp-tool.ts` extension registers tools during `session_start`, but the actual MCP server connections happen in the background. Tools appear once connected, not at session_start time.

6. **Circuit breaker state is per-session.** The failure counter resets on session switch. This is correct — a new session should have a clean slate.

7. **Graphify context is injected in `before_agent_start`**, not `context`. This means it's part of the initial message batch, not the per-turn context. It appears once per prompt, not once per turn.

8. **Background agent tasks are process-backed.** `kill_background_task` only works while the child process is still running. Completed agents can be continued with `SendMessage`, which respawns the agent with previous-output context.

9. **Verification agents default to background.** The `verification` agent has `background: true`, so invoking it returns immediately and reports later through a `<task-notification>` message.
