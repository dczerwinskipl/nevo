---
id: server-session-choice-resolution
status: draft
change: session-continuity-choice
depends_on: [ definition-session-choice-schema ]
context:
  required:
    - specs/active/session-continuity-choice/overview.md
    - specs/active/session-continuity-choice/owner-decisions.md
    - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
    - tools/specs/workflow/resolve-incoming-execution.mjs
  optional:
    - tools/tests/deterministic-execution-session-policy-unification.test.mjs
    - tools/tests/deterministic-status-corrective.test.mjs
allowed_paths:
  - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/tests/deterministic-execution-session-choice.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
semantic_references:
  decisions: [D1, D4]
  dependency_contracts: [definition-session-choice-schema]
---

# Task: Server session-choice resolution

## Dependencies

`definition-session-choice-schema` (`allow`, `reuseFrom`).

## Goal

Make the server derive the reuse candidate from `reuseFrom` and accept an owner-chosen
session policy only within what the definition allows.

## Requirements

- Candidate derivation: when the matched transition declares `reuseFrom`, the candidate is
  the `sessionId` of the most recent history entry of that step (falling back to its
  single matching binding, as the current walk does). Without `reuseFrom` the current
  backwards walk is unchanged.
- Policy choice: the effective policy is `body.sessionPolicy` if present and in the
  transition's `allow`, else the declared `session`. A `sessionPolicy` not in `allow` is
  rejected with a specific error (the existing "conflicts with server-resolved policy"
  rule remains for transitions without `allow`).
- For an effective `reuse`: `body.sessionId`, if given, must equal the derived candidate;
  no candidate is an error naming the step that was searched.
- Provider compatibility: if the policy-resolved provider for the target role differs from
  the candidate session's provider, reuse is rejected with a distinct error code, never
  silently switched.
- For an effective `fresh`: unchanged; supplying a `sessionId` is still rejected.
- The `/turns` routes surface the new errors with stable codes; no behavior change for
  requests that do not use the new fields.

## Implementation constraints

- The client never supplies an authoritative session id; it may only confirm the server's.
- Reuse the existing reuse-path (`reuse` resolves the canonical session without creating
  one); do not fork a second path.

## Acceptance criteria

- With `reuseFrom: implementation`, the candidate is the implementation session even when
  a later review session exists.
  `automated: node --test tools/tests/deterministic-execution-session-choice.test.mjs`
- `sessionPolicy: fresh` against a `reuse`-default transition with `allow: [reuse, fresh]`
  creates a new session; `sessionPolicy: reuse` appends a turn to the candidate session.
  `automated: node --test tools/tests/deterministic-execution-session-choice.test.mjs`
- A `sessionPolicy` outside `allow`, a mismatching `sessionId`, a missing candidate, and a
  provider mismatch are each rejected with distinct codes.
  `automated: node --test tools/tests/deterministic-execution-session-choice.test.mjs`
- Existing session-policy suites pass unchanged.
  `automated: node --test tools/tests/deterministic-execution-session-policy-unification.test.mjs`
  `automated: node --test tools/tests/deterministic-status-corrective.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-execution-session-choice.test.mjs
node --test tools/tests/deterministic-execution-session-policy-unification.test.mjs
node --test tools/tests/deterministic-status-corrective.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The actions DTO (task 03), batch sequencing (task 05), and UI.
