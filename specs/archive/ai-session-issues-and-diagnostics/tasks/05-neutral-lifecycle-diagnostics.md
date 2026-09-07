---
id: ai-session-issues-and-diagnostics.neutral-lifecycle-diagnostics
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/lifecycle-diagnostics-and-timeouts.md
    - specs/active/ai-session-issues-and-diagnostics/areas/canonical-turn-work-model.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/sessions/turns/runtime.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/diagnostics/**
  - tools/dashboard/server/ai/sessions/turns/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs
  - tools/dashboard/tests/fixtures/ai-diagnostics/**
forbidden_paths:
  - tools/dashboard/server/ai/providers/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D3, D7, D8, D10]
  constraints: [C1, C9, C10, C12, C13, C14]
  dependency_contracts: [canonical-turn-work-contract]
---

# Task: Implement neutral lifecycle diagnostics

## Goal

Implement the compact, provider-neutral, non-authoritative per-Turn lifecycle trace before changing
terminal transition behavior, so subsequent runtime/provider work is diagnosable.

## Requirements

- Implement the minimum trace envelope, safe allow-listed metadata, Turn-local sequencing,
  monotonic elapsed time, and correlation defined by the lifecycle area.
- Add bounded local retention and atomic/ordered append behavior under `.nevo-ai-local` without a new
  dependency.
- Instrument existing runtime transition requests, emitted semantic events, timeout checks,
  cancellation intent, and persistence handoff points available in this task's scope.
- Record accepted, suppressed, and late transition disposition.
- Exclude prompts, answer/reasoning text, command text, tool input/output, raw payloads, and secrets
  by default.
- Surface trace sink failure without changing the Turn outcome.
- Provide a read-only server-side inspection/export operation by Turn ID; no browser diagnostics UI.

## Acceptance criteria

1. A deterministic trace fixture answers Turn start, last safe provider activity, open tool/wait,
   transition owner, cancellation/timeout initiator, terminal evidence, and persistence handoff.
   `automated: node --test tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs`
2. Transition races record accepted and late/suppressed signals in sequence.
   `automated: node --test tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs`
3. Default trace serialization excludes all prohibited content fields and rejects unsafe
   provider-specific metadata. `automated: node --test tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs`
4. Sink append/flush/retention failure is visible but never changes Turn state/outcome.
   `automated: node --test tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs`
5. The trace cannot be used as the canonical recovery/state replay source.
   `inspection: dependency and API review`

## Verification

```text
node --test tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs
```
