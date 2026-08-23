---
id: chat-ux-improvements-pt1.antigravity-terminal-error-handling
status: implemented
change: chat-ux-improvements-pt1
depends_on: [semantic-chat-presentation-model]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - tools/ai/antigravity-adapter.mjs
    - tools/tests/antigravity-adapter.test.mjs
    - tools/tests/ai-turn-runtime.test.mjs
  optional: []
allowed_paths:
  - tools/ai/antigravity-adapter.mjs
  - tools/tests/antigravity-adapter.test.mjs
  - tools/tests/ai-turn-runtime.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
  - tools/dashboard/server/**
---

# Task: Handle Antigravity terminal error results

## Goal

Handle Antigravity terminal provider payloads (`event: "result"` / `type: "done"`) that
carry an error status (e.g. `result.status: "ERROR"`, `result.error`) so that the turn
fails cleanly with the provider error message (`turn.failed`) instead of unconditionally
finishing as successful (`turn.completed`) with empty assistant prose and leaving no visible
error in the UI.

## Problem statement

In reference session `1ddd3304-36cc-4669-a910-d5b6901c1ddc` (Antigravity conversation
`9ad25a0c-6fb2-4122-87bf-8a9efc31a089`), Antigravity emitted:

```json
{
  "event": "result",
  "result": {
    "status": "ERROR",
    "response": "",
    "error": "ContentOffset 22500 exceeds line range size 1792"
  }
}
```

The adapter treated top-level `event: "result"` as unconditional success, ignored
`result.status: "ERROR"`, and called `finishTurn()`. Consequently, the transcript contained
an empty assistant message, active turn was cleared, and the UI displayed no error.

## Implementation constraints

1. For `event: "result"`, `type: "done"`, and `type: "turn.completed"`, check the status
   of the payload (`payload.status`, `raw.status`, `payload.is_error`, `raw.is_error`).
2. When the status indicates error:
   - Preserve and emit non-empty `result.response` if present (without duplicating already
     streamed text).
   - Emit usage metrics if present in the terminal payload.
   - Conclude the turn as failed (`failTurn`) using the error message from `result.error`.
   - When `response` is empty, do not emit text deltas or create empty assistant prose.
   - Do not call `finishTurn()`.
3. Preserve existing successful result handling and streamed text deduplication.
4. No frontend or contract changes unless strictly required.

## Acceptance criteria

1. `event: "result"` + `status: "ERROR"` + empty `response` terminates in `turn.failed`,
   emits no `turn.completed`, and creates no empty assistant prose message.
2. `event: "result"` + `status: "ERROR"` + non-empty `response` preserves response text
   and terminates in `turn.failed`.
3. Successful `event: "result"` terminates in `turn.completed`.
4. Response text already streamed via `step_update` is not duplicated by the terminal payload.
5. Usage metrics from the terminal payload are preserved on failed turns.

## Verification

```text
node --test tools/tests/antigravity-adapter.test.mjs tools/tests/ai-turn-runtime.test.mjs
```
