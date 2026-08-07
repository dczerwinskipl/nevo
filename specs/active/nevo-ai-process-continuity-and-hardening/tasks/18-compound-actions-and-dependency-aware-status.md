---
id: nevo-ai-process-continuity-and-hardening.compound-actions-and-dependency-aware-status
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - conversational-approval-ergonomics
  - resume-and-continue-controller
  - batch-execution-and-gating-review
semantic_references:
  decisions: [D2, D3, D17, D34, D35]
  constraints: [C1, C2, C8]
  dependency_contracts:
    - conversational-approval-ergonomics
    - resume-and-continue-controller
    - batch-execution-and-gating-review
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/compound-actions-and-dependency-aware-status.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml
    - .claude/commands/nevo-ai/spec-approve.md
    - tools/specs/lifecycle.mjs
  optional:
    - .claude/commands/nevo-ai/task-start.md
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/tests/compound-actions.test.mjs
  - tools/tests/status-dependency-aware.test.mjs
  - .claude/commands/nevo-ai/spec-approve.md
  - specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml
  - docs/decisions/ADR-0006-process-continuity-and-hardening.md
consequential_paths:
  - docs/index.generated.md
  - docs/index.generated.json
  - specs/active.generated.md
  - specs/index.generated.json
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/reference/**
  - specs/archive/**
  - AGENTS.md
  - CLAUDE.md
---

# Task: Complete owner-facing compound actions and dependency-aware status

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.
> Closes `follow-ups.yaml` FU-002 and FU-004 (both `status: open`).

## Goal

Closes D34 property 5 (no repeated confirmation of an already-authorized action),
property 7 (deterministic evidence and lifecycle writes), and property 10 (no ceremony
caused only by internal command boundaries). `spec-approve`'s "approve and start"
outcome continues directly into implementation after `start` succeeds, in the same turn
(FU-002); `deriveStage`'s `ready-to-start` stage never reports an `approved` task as
ready unless `depsSatisfied` is true (FU-004).

## Dependencies

`conversational-approval-ergonomics` (task 04) — owns `spec-approve.md`'s existing
"approve and start" outcome (D3/D17); this task extends its post-`start` success path.

`resume-and-continue-controller` (task 03) — owns `deriveStage`; this task extends its
`ready-to-start` stage computation.

`batch-execution-and-gating-review` (task 08) — this task's compound-action fix reuses
the existing batch implementation loop rather than building a second one.

## Implementation constraints

- In `spec-approve.md`'s "Approve and start" section: after `approve` and `start` both
  succeed (the existing happy path, no D17 stop condition triggered), continue directly
  into the batch controller's single-task implementation loop (task 08) in the same
  turn — do not end the response with `Implement, then /nevo-ai:task-review ...`.
- Every existing D17 stop condition (`unsafe_manual`, unrelated dirty files `REC-06`,
  scope expansion `REC-08`, ADR conflict `REC-09`, `not_retryable`, a failed acceptance
  criterion, an unresolved `confirm-required` the owner hasn't yet confirmed) still ends
  the combined flow exactly as it does today — this task changes only what happens after
  every such condition is already clear and `start` has genuinely completed.
- Plain `Approve` (no start) is untouched — verify by inspection and a regression test
  that its closing shape is unchanged.
- In `tools/specs/lifecycle.mjs`'s `deriveStage`: before returning `ready-to-start` for
  the first `approved` task found, call `depsSatisfied(task, change)` (task 01, the same
  predicate `handleStart` uses). If false, do not return `ready-to-start` for that task
  — instead, report it as blocked-on-dependencies (naming the unmet dependency task(s)
  and their current status) and continue searching for the actual next genuinely
  executable task/action (an earlier ready task, or the blocking dependency's own next
  action).
- Add a `follow-ups.yaml` update marking FU-002 and FU-004 `status: resolved` with a
  `resolution` referencing this task once both are actually fixed and tested — do not
  mark them resolved preemptively.
- Do not modify `spec-approve`'s outcome menu shape, D3/D14's approval semantics, or any
  `deriveStage` stage other than `ready-to-start` (a broader audit is out of scope, per
  the area file).

## Acceptance criteria

1. A fully successful "approve and start" run (no D17 stop condition triggered) ends
   having actually begun implementation in the same turn — its closing summary contains
   no `Implement, then ...` handoff text
   (`automated: node --test tools/tests/compound-actions.test.mjs`).
2. Plain `Approve` (no start) still stops after approval, with its existing closing
   shape unmodified (automated).
3. Each of D17's existing stop conditions (`unsafe_manual`, `REC-06`, `REC-08`,
   `REC-09`, `not_retryable`, a failed acceptance criterion) still ends the combined
   flow exactly as before this task (automated, one fixture per condition).
4. `deriveStage`'s `ready-to-start` stage never returns a task whose `depsSatisfied` is
   false; a fixture with an `approved` task depending on an `in-implementation` task
   reports the dependency, not the approved task, as the next stage
   (`automated: node --test tools/tests/status-dependency-aware.test.mjs`).
5. A task reported as blocked-on-dependencies names the specific unmet dependency
   task(s) and their current status (automated).
6. `status`'s reported next action is consistent with what `start` would actually
   accept for that same task at that same moment, verified across a representative set
   of `deriveStage` stages, not only `ready-to-start` (automated).
7. `follow-ups.yaml`'s FU-002 and FU-004 entries are updated to `status: resolved` with
   a `resolution` field referencing this task, only after AC1-AC6 pass
   (`inspection`).
8. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
   report clean after this task's changes (automated).
9. `node --test tools/tests/*.test.mjs` (full suite, including the two new test files)
   passes (automated).

## Verification

```
node --test tools/tests/compound-actions.test.mjs
node --test tools/tests/status-dependency-aware.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new subsection covering
the general "a compound action completes the operation its label promises" rule and the
dependency-aware status fix; "Context" paragraph names task 18 alongside tasks 01-17).

## Out of scope

- Any change to `spec-approve`'s four-outcome menu shape, or D3/D14's approval
  semantics.
- Any change to D17's combined-transition stop-condition list.
- Auditing every other `deriveStage` stage for a similar dependency-awareness gap —
  flagged as a candidate follow-up if discovered, not silently expanded into this
  task's scope.
- Any change to the batch controller loop's own implementation beyond wiring the
  compound action to reuse it.
