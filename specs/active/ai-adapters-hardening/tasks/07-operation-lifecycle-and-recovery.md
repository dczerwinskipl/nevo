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
    - tools/dashboard/server/ai/sessions/turns/runtime.mjs
    - tools/dashboard/server/ai/sessions/turns/coordinator.mjs
    - tools/dashboard/server/ai/sessions/turns/turn-recovery.mjs
    - tools/dashboard/server/ai/providers/registry.mjs
    - tools/dashboard/server/ai/providers/process-termination.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
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

Harden `runtime.mjs`, `coordinator.mjs`, `turn-recovery.mjs`, and `registry.mjs` to preserve epistemic truth on lost operations via transient `status: 'unknown'` state, enforce authoritative reconciliation rules, handle remote forced cleanup settling as `interrupted`, and decouple provider health from per-turn rate limits.

## Requirements

- Update `TurnLifecycleCoordinator` to transition turns to `status: 'unknown'` with code `AI_OPERATION_LOST` and reason `'operation_lost'` when provider connection or child handle drops unexpectedly without a terminal protocol frame.
- Strictly block new turn dispatch for any session whose active turn is in `status: 'unknown'`, preventing concurrent conflicts or out-of-order execution.
- Implement authoritative reconciliation: allow state resolution of provider results (`completed` or `failed`) only via authoritative provider evidence (late completion/failure protocol frame or status query). Confirmed PID termination proves only that process liveness has ended; it does not by itself prove a semantic provider outcome.
- Implement forced cleanup and remote recovery call path: HTTP route -> `AgentSessionService` -> `AgentTurnRuntime` -> provider cancellation / process cleanup -> `TurnLifecycleCoordinator`.
  - When an unprovable `unknown` operation occurs, the user or operator triggers remote recovery through the API.
  - `AgentTurnRuntime` aborts the provider child process tree via `terminateChildProcess()`, confirms process death, and instructs `TurnLifecycleCoordinator` to settle turn status as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')`.
  - Strictly differentiate normal user cancellation (`outcome: 'cancelled', initiator: 'user'`) from recovery of an unprovable `unknown` operation (`outcome: 'interrupted', cause: 'forced_cleanup'`).
  - Remote recovery releases session lock and enables subsequent turn dispatch without requiring physical workstation or local terminal intervention.
- Update `AgentProviderRegistry` to decouple stable facts (`enabled`, `installed`, `version`) from transient health (`status`, `authenticated`).
- Enforce turn error isolation: a per-turn rate limit (HTTP 429), quota exhaustion, or CLI failure must never alter `provider.health.status` to `unavailable` or `installed: false`.

## Acceptance criteria

1. Dropped provider operations transition to `status: 'unknown'` with code `AI_OPERATION_LOST` rather than falsely claiming `outcome: 'failed'`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
2. Session turn queue rejects new turn submissions while active turn is in `status: 'unknown'`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
3. State reconciliation preserves epistemic truth: confirmed PID termination proves liveness cessation without fabricating provider results; provider completion or failure requires authoritative provider protocol evidence or status queries. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
4. Remote recovery call path (`AgentTurnRuntime` -> process cleanup -> `coordinator`) resolves unknown turns as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')` after process tree termination is verified, releasing the session for new turn dispatch without physical workstation intervention. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
5. Normal user cancellation is cleanly distinguished from forced recovery, settling as `terminal (outcome: 'cancelled', initiator: 'user')`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
6. Per-turn rate limits and process crashes do not mutate provider descriptor health to `unavailable` or `installed: false`. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`
7. Server restart boot reconciliation correctly marks orphaned active turns as `terminal (outcome: 'interrupted', cause: 'server-restart')` and preserves pending restart-capable interactions. `automated: node --test tools/dashboard/tests/turn-recovery.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/turn-recovery.test.mjs
```
