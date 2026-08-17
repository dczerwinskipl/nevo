# Area: Claude Provider Adapter

## Responsibilities

This area implements the `AgentProvider` adapter for local Claude Code CLI (`claude`), serving as the primary subscription-backed driver for the multi-provider system.

## 1. Process Execution & Stream Protocol

- **CLI Invocations:**
  - Turn creation: `claude -p --output-format stream-json --input-format stream-json --resume <providerSessionId>`
  - Initial session creation: `claude -p --output-format stream-json --input-format stream-json --session-id <newUuid>`
- **Stream JSON Parsing:**
  - Reads line-delimited JSON objects from child process `stdout`.
  - Maps Claude event structures (`content_block_delta`, `tool_use`, `thinking`, `assistant_response`, `error`) to normalized `AgentEvent`s.
- **Provider Session ID Capture:**
  - Extracts and stores Claude session UUID from stdout headers / session start event into local session registry.

## 2. Interactive Permissions & Questions

- **Permissions:**
  - Claude CLI prompts for tool execution permission (e.g. bash commands, file modifications).
  - Adapter intercepts permission event, assigns stable `interactionId`, pauses turn state to `waitingForUser`, and emits `interaction.requested` (kind `permission`).
  - Upon user approval/rejection via HTTP API, adapter sends JSON response back to child process `stdin`.
- **AskUserQuestion / Interactive Questions:**
  - When Claude invokes `AskUserQuestion` or requests user clarification, adapter emits `interaction.requested` (kind `question`) with questions array and stable question IDs.
  - User answers submitted via HTTP API are formatted and written to child process `stdin`.

## 3. Cancellation & Process Cleanup

- When `cancelTurn` is called via HTTP API, the adapter sends SIGINT/SIGTERM to the running child process and gracefully marks the turn status as cancelled/interrupted.
- Standard error (`stderr`) is monitored for diagnostic and authentication issues (e.g. expired credentials), mapping them to descriptive `turn.failed` errors without leaking raw system stack traces.

## 4. Declared Capabilities

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
