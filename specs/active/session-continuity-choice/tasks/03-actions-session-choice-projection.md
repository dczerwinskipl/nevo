---
id: actions-session-choice-projection
status: draft
change: session-continuity-choice
depends_on: [ server-session-choice-resolution ]
context:
  required:
    - specs/active/session-continuity-choice/overview.md
    - specs/active/session-continuity-choice/owner-decisions.md
    - tools/dashboard/server/specs/actions.mjs
    - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
    - tools/dashboard/ui/features/specifications/types.ts
allowed_paths:
  - tools/dashboard/server/specs/actions.mjs
  - tools/dashboard/ui/features/specifications/types.ts
  - tools/dashboard/tests/specs-actions-session-choice.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/features/specifications/tasks/**
  - tools/dashboard/ui/screens/**
semantic_references:
  decisions: [D1, D4]
  dependency_contracts: [server-session-choice-resolution]
---

# Task: Actions session-choice projection

## Dependencies

`server-session-choice-resolution` (the same derivation must back the projection, so the
UI is shown exactly what the server will accept).

## Goal

Expose the owner's session choice for a task's next step in the task actions DTO.

## Requirements

- For a task whose next agent step has a matched incoming transition with more than one
  allowed policy, `actions.tasks[taskId].sessionChoice` is:
  `{ default, allowed, candidate, unavailableReason }`.
  - `candidate`: `{ sessionId, step, attempt, provider, label }` or `null`.
  - `unavailableReason`: a machine code plus a human sentence when `reuse` is allowed by
    the definition but cannot be offered (no candidate, provider mismatch).
- Use the server's own derivation from task 02 (shared function, not a copy).
- For tasks with a single allowed policy, `sessionChoice` is absent, so existing consumers
  are unaffected.
- Mirror the shape in the UI `types.ts` (types only).

## Acceptance criteria

- A task after "Request changes" has `default: 'reuse'`, `allowed: ['reuse', 'fresh']`,
  and the implementation session as `candidate`.
  `automated: node --test tools/dashboard/tests/specs-actions-session-choice.test.mjs`
- A task with no matching candidate or a provider mismatch reports `unavailableReason`
  and a `null` candidate.
  `automated: node --test tools/dashboard/tests/specs-actions-session-choice.test.mjs`
- A single-policy transition has no `sessionChoice`.
  `automated: node --test tools/dashboard/tests/specs-actions-session-choice.test.mjs`
- Existing actions tests pass.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/specs-actions-session-choice.test.mjs
node --test tools/dashboard/tests/specs-actions.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any rendering.
