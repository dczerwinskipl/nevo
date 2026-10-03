---
id: resume-and-terminal-audit-trail
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/terminal-execution-classification-and-resumability.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/specs/activity/model.mjs
    - tools/specs/activity/store.mjs
    - tools/specs/activity/actor-resolver.mjs
  optional:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/tasks/06-workflow-step-activity-producer.md
    - specs/active/ai-spec-history/tasks/07-human-verification-activity-producer.md
depends_on:
  - terminal-reconciliation-adopts-outcome
allowed_paths:
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/activity/model.mjs
  - tools/specs/activity/store.mjs
  - tools/specs/activity/actor-resolver.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - src/**
semantic_references:
  decisions: [D1, D2, D5]
  dependency_contracts: [terminal-reconciliation-adopts-outcome]
---

# Task: Resume and terminal audit trail

## Dependencies

`terminal-reconciliation-adopts-outcome` (this task hooks the same call sites that already
branch on `outcome`).

## Goal

Per D5, record an automatic, queryable audit trail for resume events using the already
implemented and approved `tools/specs/activity/store.mjs` (`recordActivity`) and
`actor-resolver.mjs` — no new durable store. Emit one activity record whenever a claim is
released with `outcome: 'resumable'` — **all three** sub-cases (D1/D2 amendments,
spec-review F1 and the finish-operation-replay correction): an active attempt left
mid-flight, a pre-activation remediation turn abandoned without success, and a
deterministically-replayable finish-operation record left behind — with previous
session/turn id, step, attempt, and timestamp. Emit a second, linked activity record on the
next admission that resumes that same `(changeSlug, taskId, step, attempt)` (new
session/turn id, timestamp). Do not special-case any of the three `resumable` sub-cases
differently — all three are "safely released, legal work remains" and all three deserve the
same audit visibility.

## Implementation constraints

- **Coordinate, do not duplicate, with `ai-spec-history`'s `workflow-step-activity-producer`
  / `human-verification-activity-producer` tasks** — check their current status/diff before
  editing `admission.mjs`; this task's event kind (terminal-classification/resume) is
  distinct from those tasks' step-start/finish producer events, but both may touch nearby
  code in the same file. Resolve any overlap by coordinating scope, not by redefining
  either task's event shape.
- Use `recordActivity`'s existing envelope shape (`model.mjs`) as-is — do not invent a new
  envelope schema. Use `actor-resolver.mjs` for actor identity — do not write a second
  resolver.
- The "linked second event" must be derivable without scanning the entire activity log on
  every admission — use `(changeSlug, taskId, step, attempt)` as the correlation key,
  reading only the specific spec's activity file.
- Do not make activity emission a hard dependency of the release/admission path — emission
  failure must never block the underlying claim release or admission itself (log/report,
  do not throw).

## Acceptance criteria

- Releasing a claim with `outcome: 'resumable'` writes exactly one activity record
  containing the previous session id, previous turn id, step, attempt, and a timestamp —
  verified for all three sub-cases (active-mid-flight, never-activated/abandoned, and
  replayable-finish-left-behind). `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A subsequent admission that resumes the same `(changeSlug, taskId, step, attempt)` writes
  a second activity record containing the new session/turn id and a timestamp, correlated
  to the first via the `(changeSlug, taskId, step, attempt)` key.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- An admission for a *different* task, or for the same task's *next* attempt after a real
  finish, does not produce a spurious "resumed" correlation.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A simulated activity-store write failure does not prevent the claim release or the
  admission from succeeding. `automated: node --test tools/tests/workflow-continuation.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to `tools/specs/activity/*` itself. Dashboard/UI surfacing of this audit trail.
