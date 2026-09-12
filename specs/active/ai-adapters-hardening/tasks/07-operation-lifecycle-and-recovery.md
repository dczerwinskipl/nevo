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
    - tools/dashboard/server/ai/sessions/turns/turn-lifecycle-coordinator.mjs
    - tools/dashboard/server/ai/sessions/turns/turn-recovery.mjs
    - tools/dashboard/server/ai/providers/registry.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/sessions/turns/turn-lifecycle-coordinator.mjs
  - tools/dashboard/server/ai/sessions/turns/turn-recovery.mjs
  - tools/dashboard/server/ai/providers/registry.mjs
  - tools/dashboard/tests/ai-lifecycle-recovery.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/providers/antigravity/**
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

Harden `TurnLifecycleCoordinator`, `turn-recovery.mjs`, and `AgentProviderRegistry` to preserve epistemic truth on lost operations via transient `status: 'unknown'` state, enforce authoritative reconciliation rules, handle forced cleanup settling as `interrupted`, and decouple provider health from per-turn rate limits.

## Requirements

- Update `TurnLifecycleCoordinator` to transition turns to `status: 'unknown'` with code `AI_OPERATION_LOST` and reason `'operation_lost'` when provider connection or child handle drops unexpectedly without a terminal protocol frame.
- Strictly block new turn dispatch for any session whose active turn is in `status: 'unknown'`, preventing concurrent conflicts or out-of-order execution.
- Implement authoritative reconciliation: allow state resolution only via authoritative evidence (late completion/failure protocol notification, verified PID termination check, or status query).
- Implement forced cleanup recovery API: when an operator or recovery supervisor aborts an unknown operation and verifies process tree termination, transition turn status to `terminal (outcome: 'interrupted', cause: 'forced_cleanup')` without claiming an unobserved provider result.
- Update `AgentProviderRegistry` to decouple stable facts (`enabled`, `installed`, `version`) from transient health (`status`, `authenticated`).
- Enforce turn error isolation: a per-turn rate limit (HTTP 429), quota exhaustion, or CLI failure must never alter `provider.health.status` to `unavailable` or `installed: false`.

## Acceptance criteria

1. Dropped provider operations transition to `status: 'unknown'` with code `AI_OPERATION_LOST` rather than falsely claiming `outcome: 'failed'`. `automated: node --test tools/dashboard/tests/ai-lifecycle-recovery.test.mjs`
2. Session turn queue rejects new turn submissions while active turn is in `status: 'unknown'`. `automated: node --test tools/dashboard/tests/ai-lifecycle-recovery.test.mjs`
3. State reconciliation succeeds only when supported by authoritative evidence (terminal protocol event or verified PID termination). `automated: node --test tools/dashboard/tests/ai-lifecycle-recovery.test.mjs`
4. Forced cleanup resolves unknown turns as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')` after process tree termination is verified. `automated: node --test tools/dashboard/tests/ai-lifecycle-recovery.test.mjs`
5. Per-turn rate limits and process crashes do not mutate provider descriptor health to `unavailable` or `installed: false`. `automated: node --test tools/dashboard/tests/ai-lifecycle-recovery.test.mjs`
6. Server restart boot reconciliation correctly marks orphaned active turns as `terminal (outcome: 'interrupted', cause: 'server-restart')` and preserves pending restart-capable interactions. `automated: node --test tools/dashboard/tests/ai-lifecycle-recovery.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/ai-lifecycle-recovery.test.mjs
```
