# Area: Claude Provider Adapter

## Responsibilities

This area implements the `AgentProvider` adapter for local Claude Code CLI (`claude`), serving as the primary subscription-backed driver for the multi-provider system based on verified runtime capabilities.

## 1. Process Execution & Stream Protocol

- **CLI Invocations:**
  - Turn execution: `claude -p --output-format stream-json --input-format stream-json --resume <providerSessionId>`
  - Initial session creation: `claude -p --output-format stream-json --input-format stream-json --session-id <newUuid>`
- **Short-Lived Turn Model:**
  - Each turn spawns a short-lived `claude` process.
  - The process streams line-delimited JSON objects on `stdout` and exits when the turn finishes or a tool is deferred.
  - Line-delimited JSON objects (`content_block_delta`, `tool_use`, `thinking`, `assistant_response`, `error`) are translated into normalized `AgentEvent`s using `text.delta`.

## 2. Interactive Questions via `PreToolUse/defer` (Decided)

Claude Code does not provide a documented interactive request-response contract over stdin pipes during a live turn. Instead, it natively supports `PreToolUse` hook deferrals (supported in Claude Code >= 2.1.89):

```text
Claude initiates AskUserQuestion
        ↓
PreToolUse Hook intercepts tool call
        ↓
Hook returns permissionDecision: "defer"
        ↓
Claude process exits cleanly with:
  stop_reason: "tool_deferred"
  session_id: <providerSessionId>
  deferred_tool_use: { id, name, input }
        ↓
Nevo Adapter captures deferral and emits interaction.requested (kind: 'question')
        ↓
User answers question in Dashboard UI
        ↓
Nevo triggers resume on same session:
  claude --resume <providerSessionId>
        ↓
PreToolUse Hook re-executes with allow + updatedInput containing user answers
        ↓
Claude continues execution
```

- **Known Limitation:** `PreToolUse/defer` cannot defer multiple interactive tool calls occurring simultaneously in a single parallel batch. The adapter and test suite explicitly record this known boundary.

## 3. Native Permissions Discovery & Mapping (Task 03 Required)

Unlike `AskUserQuestion`, the transport mechanism for **native permission prompts** is not pre-decided. Task 03 discovery evaluates and compares:
1. `--permission-prompt-tool`
2. `PreToolUse/defer`
3. Agent SDK `canUseTool`

against native permission semantics, subscription authentication, and clean allow/deny resolution. The selected transport will be recorded in a decision record and implemented in Task 05 without building a redundant custom permission engine.

## 4. Cancellation & Process Cleanup

- When `cancelTurn` is called via HTTP API, the adapter sends SIGINT/SIGTERM to the active child process and cleanly marks the turn as cancelled/interrupted.

## 5. Declared Capabilities

```ts
export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
};
```
