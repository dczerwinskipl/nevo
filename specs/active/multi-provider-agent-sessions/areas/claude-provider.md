# Area: Claude Provider Adapter

## Responsibilities

This area implements the `AgentProvider` adapter for local Claude Code CLI (`claude`), serving as the primary subscription-backed driver for the multi-provider system based on verified runtime capabilities.

## 1. Process Execution & Stream Protocol

- **CLI Invocations:**
  - Initial session turn (when `providerSessionId` is omitted): `claude -p --verbose --output-format stream-json --input-format stream-json --settings <tempSettingsJson> --session-id <newUuid> --permission-mode dontAsk`
  - Continuation turn (when `providerSessionId` is provided): `claude -p --verbose --output-format stream-json --input-format stream-json --settings <tempSettingsJson> --resume <providerSessionId> --permission-mode dontAsk`

- **Hook Injection:**
  - Invocations inject a per-process settings JSON file via `--settings` configuring `PreToolUse` command hook pointing to `tools/ai/claude-hook.mjs`.

- **Short-Lived Turn Model:**
  - Each turn spawns a short-lived `claude` process.
  - The process streams line-delimited JSON objects on `stdout` and exits when the turn finishes or a tool is deferred (`stop_reason: "tool_deferred"`).
  - Session materialization is verified when output contains `session_id == expectedUUID`.
  - Line-delimited JSON objects (`content_block_delta`, `tool_use`, `thinking`, `assistant_response`, `error`) are translated into normalized `AgentEvent`s using `text.delta`.

## 2. Interactive Questions via `PreToolUse/defer` Command Hook (Decided & Verified)

Claude Code executes configured command hooks via OS process spawning on stdin/stdout:

```text
Claude initiates AskUserQuestion
        ↓
PreToolUse Command Hook (claude-hook.mjs) called by Claude via stdin JSON
        ↓
Hook returns hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer" }
        ↓
Claude process exits cleanly (code 0) with:
  stop_reason: "tool_deferred"
  session_id: <providerSessionId>
  deferred_tool_use: { id, name, input }
        ↓
Nevo Adapter captures deferral, stores durable private continuation in ClaudeContinuationStore,
and emits normalized interaction.requested (kind: 'question', id: 'int-<uuid>')
        ↓
User answers question in Dashboard UI
        ↓
Nevo persists resolved response in ClaudeContinuationStore
        ↓
Nevo triggers resume on same session:
  claude -p --verbose --output-format stream-json --input-format stream-json --settings <settings> --resume <providerSessionId> --permission-mode dontAsk
        ↓
PreToolUse Command Hook executes again on resume, reads resolved continuation,
maps answers by question text, and outputs:
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: { questions: [...], answers: { "<question text>": "<value>" } }
  }
        ↓
Continuation record is consumed; Claude executes tool and continues generation
```

- **Parallel Tool Batch Limitation:** Interactive `AskUserQuestion` deferral is supported for a single deferred tool call. Parallel tool batches are not guaranteed/supported for the defer/resume interaction flow and must not be exposed as a recoverable Nevo interaction unless Claude actually returns a supported `deferred_tool_use` contract.



## 3. Native Permissions Transport (Evaluated & Discovered)

Task 03 discovery evaluated potential transports for native permission prompts:
1. `--permission-prompt-tool`: Requires bespoke IPC pipes per tool execution and is not uniformly supported across CLI versions.
2. `PermissionRequest` hooks: Fire only when Claude Code is in interactive prompt mode. In headless execution (`claude -p` with `--permission-mode dontAsk`), permission interactive round-trip is not supported by the CLI binary without interactive prompt loop.
3. Fictional in-process interceptors: Inventing custom permission wrappers on top of arbitrary tools was rejected.

- **Decision:** As non-interactive CLI does not support native permission round-trips without interactive prompt loops, `interactivePermissions` is set to `false`. Interactive multi-choice questions (`AskUserQuestion`) are fully supported and verified via `PreToolUse/defer` command hooks.

## 4. Cancellation & Process Cleanup

- When `cancelTurn` is called via HTTP API, the adapter sends SIGINT/SIGTERM to the active child process and cleanly marks the turn as cancelled/interrupted.

## 5. Declared Capabilities

```ts
export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  interactivePermissions: false,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
```

