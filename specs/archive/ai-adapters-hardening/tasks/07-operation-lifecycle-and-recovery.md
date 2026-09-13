---
id: ai-adapters-hardening.operation-lifecycle-and-recovery
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/05-error-terminal-taxonomy.md
    - specs/active/ai-adapters-hardening/areas/06-operation-process-lifecycle.md
    - specs/active/ai-adapters-hardening/areas/07-availability-metadata.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
    - tools/dashboard/server/ai/sessions/service.mjs
    - tools/dashboard/server/ai/sessions/turns/runtime.mjs
    - tools/dashboard/server/ai/sessions/turns/coordinator.mjs
    - tools/dashboard/server/ai/sessions/turns/turn-recovery.mjs
    - tools/dashboard/server/ai/providers/registry.mjs
    - tools/dashboard/server/ai/providers/process-termination.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/dashboard/server/ai/sessions/service.mjs
  - tools/dashboard/server/ai/sessions/turns/runtime.mjs
  - tools/dashboard/server/ai/sessions/turns/coordinator.mjs
  - tools/dashboard/server/ai/sessions/turns/turn-recovery.mjs
  - tools/dashboard/server/ai/providers/registry.mjs
  - tools/dashboard/tests/turn-recovery.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D6, D7, D10]
  constraints: [C7, C8, C9, C10]
  dependency_contracts: [neutral-contracts-and-types, windows-process-tree-termination]
---

# Task: Harden turn lifecycle coordination, lost operation semantics, and health isolation

## Goal

Harden `routes.mjs`, `service.mjs`, `runtime.mjs`, `coordinator.mjs`, `turn-recovery.mjs`, and `registry.mjs` to preserve epistemic truth on lost operations via transient `status: 'unknown'` state, enforce authoritative reconciliation rules, provide a dedicated remote recovery API contract settling as `interrupted`, release session turn locks upon recovery, and decouple provider health from per-turn rate limits.

## Requirements

- Update `TurnLifecycleCoordinator` to transition turns to `status: 'unknown'` with code `AI_OPERATION_LOST` and reason `'operation_lost'` when provider connection or child handle drops unexpectedly without a terminal protocol frame.
- Strictly block new turn dispatch for any session whose active turn is in `status: 'unknown'`, preventing concurrent conflicts or out-of-order execution.
- Implement authoritative reconciliation: allow state resolution of provider results (`completed` or `failed`) only via authoritative provider evidence (late completion/failure protocol frame or status query). Confirmed PID termination proves only that process liveness has ended; it does not by itself prove a semantic provider outcome.
- Materialize the remote recovery API contract distinguishing normal cancellation from forced recovery:
  - **Normal cancellation**: `POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel` (default or body `{ action: 'cancel' }`). Operates on active or waiting turns, executes cancellation escalation, and settles as `terminal (outcome: 'cancelled', initiator: 'user')`.
  - **Remote forced recovery**: `POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/recover` (and `POST .../cancel` with validated `{ action: 'force_cleanup' }`).
    - Validates that turn is in non-terminal `status: 'unknown'` (or unprovable lost state).
    - Call path: `turnRoutes` (`routes.mjs`) -> `AgentSessionService.recoverTurn()` -> `AgentTurnRuntime.recoverTurn()` -> `terminateChildProcess()` -> `TurnLifecycleCoordinator`.
    - Terminates provider child process tree via `terminateChildProcess()`, confirms process death, and settles turn lifecycle outcome as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')`.
    - Clears `#activeBySession` lock in `AgentTurnRuntime`, releasing the session.
    - Remote recovery releases the session without requiring physical workstation or local terminal access, enabling subsequent turn dispatch.
- Update `AgentProviderRegistry` to decouple stable facts (`enabled`, `installed`, `version`) from transient health (`status`, `authenticated`).
- Enforce turn error isolation: a per-turn rate limit (HTTP 429), quota exhaustion, or CLI failure must never alter `provider.health.status` to `unavailable` or `installed: false`.

## Acceptance criteria

1. Dropped provider operations transition to `status: 'unknown'` with code `AI_OPERATION_LOST` rather than falsely claiming `outcome: 'failed'`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
2. Session turn queue rejects new turn submissions while active turn is in `status: 'unknown'`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
3. State reconciliation preserves epistemic truth: confirmed PID termination proves liveness cessation without fabricating provider results; provider completion or failure requires authoritative provider protocol evidence or status queries. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
4. Remote recovery API (`POST .../recover` or `POST .../cancel` with `{ action: 'force_cleanup' }`) executes `AgentSessionService` -> `AgentTurnRuntime`, terminates child process tree, and settles turn as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
5. End-to-end automated test proves a remote client can recover an `unknown` turn via the recovery API and then successfully dispatch another turn in that session without physical workstation intervention. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
6. Normal user cancellation is cleanly distinguished from forced recovery, settling as `terminal (outcome: 'cancelled', initiator: 'user')`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
7. Per-turn rate limits and process crashes do not mutate provider descriptor health to `unavailable` or `installed: false`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
8. Server restart boot reconciliation correctly marks orphaned active turns as `terminal (outcome: 'interrupted', cause: 'server-restart')` and preserves pending restart-capable interactions. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/turn-recovery.test.mjs
```
