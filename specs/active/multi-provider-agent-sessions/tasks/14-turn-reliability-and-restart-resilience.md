---
id: multi-provider-agent-sessions.turn-reliability-and-restart-resilience
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/areas/provider-neutral-core.md
    - specs/active/multi-provider-agent-sessions/owner-decisions.md
    - tools/ai/turn-runtime.mjs
    - tools/ai/claude-adapter.mjs
    - tools/ai/transcript-cache.mjs
    - tools/ai/service.mjs
    - tools/dashboard/server/ai-routes.mjs
    - tools/dashboard/server/index.mjs
allowed_paths:
  - tools/ai/**
  - tools/dashboard/server/**
  - tools/tests/**
  - tools/dashboard/tests/**
  - docs/decisions/**
  - docs/development/**
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D2, D7, D8]
  constraints: [C2, C5, C8]
---

# Task: Turn timeout watchdog, restart reconciliation, and accurate session status

## Goal

Make turn execution self-healing instead of able to spin forever: a hung provider process must
eventually fail with a clear error instead of leaving a turn `running` indefinitely, and an
ungraceful server restart (crash, kill, service restart) must never leave a session showing a
permanently "running"/"generating" ghost status. Additionally, unify how `GET /api/agent-sessions`
(list) and `GET /api/agent-sessions/:provider/:providerSessionId` (detail) compute session status
so the dashboard home page and the chat view never disagree. The user must also always have a
working way to stop a turn themselves, on demand, without waiting for the idle watchdog — the
existing cancel control must reliably appear and reliably terminate the underlying process.

## Requirements

1. **Idle-based turn watchdog (`AiTurnRuntime`):**
   - Track a last-activity timestamp per running turn (`tools/ai/turn-runtime.mjs`), refreshed by
     every emitted event for that turn: `text.delta`, `reasoning.delta`, `tool.started`,
     `tool.updated`, `tool.completed`, `usage.updated`.
   - Default idle window: `AI_TURN_IDLE_TIMEOUT_MS` = 5 minutes, overridable via
     `AiTurnRuntime` constructor options (mirroring the existing `maxEventsPerTurn` /
     `maxRetainedTurns` option pattern) and via an environment variable read at the dashboard
     server composition root.
   - When the idle window elapses for a turn whose status is `running`, the runtime cancels it
     through the same mechanism as an explicit `cancelTurn` (calling the adapter's `cancelTurn`,
     e.g. `SIGINT` to the child process) and finishes it via `#finish(state, 'turn.failed', ...)`
     with a new `AiError` code `AI_TURN_TIMEOUT`.
   - Turns with status `waitingForUser` are exempt from the idle watchdog.
   - The watchdog must not keep the Node process alive on its own when there is nothing to watch
     (use an unref'd interval/timer or equivalent) and must be cleared by `shutdown()`.

2. **Boot-time reconciliation for orphaned turns:**
   - On dashboard server startup, before the HTTP/SSE listener accepts traffic, scan persisted
     transcripts (`tools/ai/transcript-cache.mjs` storage under `.nevo-ai-local/transcripts/**`)
     for any session whose persisted `activeTurn` has no corresponding turn in the freshly
     constructed (empty) `AiTurnRuntime`.
   - Finalize each orphaned `activeTurn` as failed with error code `AI_TURN_INTERRUPTED` (reuse
     the existing code already used by `AiTurnRuntime#shutdown()`), and append a normalized
     system-visible transcript message ("Interrupted by server restart") so the next read reflects
     reality instead of a stale `running` state.
   - Sessions with a `pendingInteraction` (`waitingForUser`) are explicitly excluded from this
     reconciliation — they remain resumable via the existing cache-backed reconstruction already
     implemented in `resolveInteraction`/`cancelTurn`.
   - This reconciliation runs exactly once at boot and must complete (or be scheduled to run)
     before `listen()` starts accepting requests, so no request can observe a stale `running`
     ghost session.

3. **Session list/detail status parity:**
   - `AiService.listSessions` (`tools/ai/service.mjs`) must compute a `status` field
     (`idle` | `running` | `waitingForUser`) for each binding using the same logic as the
     single-session `GET` handler in `tools/dashboard/server/ai-routes.mjs` (live `turnRuntime`
     state via the transcript's `activeTurn`, falling back to the persisted state after boot
     reconciliation has normalized it).
   - Refactor the status-resolution logic into one shared helper used by both the list and detail
     code paths — no duplicated branching between `ai-routes.mjs` and `service.mjs`.
   - The dashboard session list UI must render this `status` field (it currently defaults to an
     idle-looking badge when the field is absent).

4. **Error surfacing:**
   - `AI_TURN_TIMEOUT` and `AI_TURN_INTERRUPTED` both normalize through the existing
     `publicAiError`/`turn.failed` event path so the chat UI shows a clear, human-readable failure
     message instead of leaving the UI silently spinning.

5. **Guaranteed, user-triggerable cancellation during an active turn:**
   - The existing chat "Przerwij"/cancel control (`tools/dashboard/src/components/ai-chat.tsx`,
     wired to `POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel`) must
     reliably render whenever a session's live status is `running`/`waitingForUser` — this falls
     out directly of requirement 3's status-parity fix (`assistant.isRunning` is driven by the same
     `activeTurn` snapshot), but must be explicitly verified end-to-end here, not merely assumed.
   - `AiTurnRuntime#cancelTurn` currently calls the adapter's `cancelTurn` (e.g.
     `claude-adapter.mjs`'s `child.kill('SIGINT')`) and unconditionally finalizes the turn without
     ever confirming the underlying child process actually exited, which can leave an orphaned OS
     process running after NEvo has already reported the turn as cancelled. Harden this by reusing
     the idle-watchdog's own bounded-wait/force-terminate mechanism from requirement 1: after
     requesting adapter cancellation, wait up to a short bounded grace period (default 5 seconds)
     for the operation to actually stop; if it hasn't, escalate to a forceful kill
     (`child.kill()` with no signal — Windows has no distinct SIGINT/SIGTERM semantics and this is
     the only reliable forced-termination path there; POSIX platforms escalate `SIGINT` →
     `SIGKILL`) before finishing the turn. This guarantees cancellation is never a no-op the user
     has to retry, on any OS.

## Verification

1. **Watchdog fires on silence:** with a fake/mocked adapter that starts a turn and never emits
   another event, advancing a fake clock past the idle window causes the turn to finish
   `turn.failed` with `AI_TURN_TIMEOUT`, and `cancelTurn` is invoked on the adapter.
2. **Watchdog resets on activity:** repeated emitted events before the idle window elapses keep the
   turn `running` indefinitely (watchdog never fires while activity continues).
3. **`waitingForUser` exemption:** a turn parked in `waitingForUser` past the idle window is not
   cancelled by the watchdog.
4. **Boot reconciliation:** a transcript fixture with a persisted `activeTurn` and no matching
   in-memory turn is finalized as `turn.failed`/`AI_TURN_INTERRUPTED` with a system message during
   server startup, verified without requiring a real process restart (construct the reconciliation
   entry point directly in a test).
5. **`pendingInteraction` untouched:** a transcript fixture with `pendingInteraction` set is left
   unmodified by boot reconciliation.
6. **List/detail parity:** `AiService.listSessions` returns the same `status` for a session as
   `GET /api/agent-sessions/:provider/:providerSessionId` for `idle`, `running`, and
   `waitingForUser` cases.
7. **Dashboard UI:** the session list component renders the live status from `listSessions`
   instead of defaulting to an idle-looking badge.
8. **Forced cancellation:** with a mocked adapter whose `cancelTurn` does not actually stop the
   underlying operation within the grace period, `AiTurnRuntime#cancelTurn` still reaches a
   terminal `turn.failed` state within a bounded time via the forceful escalation path.
9. **Cancel control visibility:** a session snapshot with a live `running` turn always yields
   `capabilities.cancelTurn: true` and a populated `activeTurn`, so the chat UI's existing cancel
   control is guaranteed to render — verified via `tools/dashboard/tests/ai-chat.test.mjs`.

```bash
node --test tools/tests/ai-turn-runtime.test.mjs
node --test tools/tests/claude-adapter.test.mjs
node --test tools/tests/ai-contracts.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
