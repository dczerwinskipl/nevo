---
id: deterministic-status-architecture.dependency-invalidation-remediation-review
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dependency-invalidation-remediation-review.md
    - specs/active/deterministic-status-architecture/areas/dependency-release-and-invalidation.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/remediation-review/**
  - tools/tests/dependency-invalidation-remediation-review.test.mjs
forbidden_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs/workflow/dependency-satisfaction.mjs
  - tools/specs/workflow/remediation-record.mjs
  - tools/dashboard/**
  - src/**
depends_on: [ dependency-release-and-invalidation, deterministic-batch-orchestrator ]
semantic_references:
  decisions: [D31, D36, D37]
---

# Task: Dependency-invalidation remediation review

## Goal

Implement D31's combined, cross-task-aware review pass for a dependency-invalidation
remediation group: after the group's fix attempts run (via the sequential queue, task 28 —
one at a time, never concurrently), review the group as a whole — per-task reviews first,
then a cross-task consistency pass modeled on the legacy `implementation-review` mechanism's
own two-pass design — and only clear the group's `suspensions` entries (task 27, D37) once
every non-terminal member, including any added during this review, passes. A terminal group
member is reviewed read-only and never reopened (D31, corrected).

## Implementation constraints

- New module tree, `tools/specs/workflow/remediation-review/**` — do not modify
  `tools/specs/lifecycle.mjs`'s legacy `implementation-review` code; adapt its two-pass
  *design* as a separate, `workflow_progress`-based implementation.
- Resolve scope by calling `remediation-record.mjs`'s `loadRemediationGroup` (task 27,
  imported not edited — forbidden path) — never a manually-typed task list.
- Per-task review: reuse whatever per-task review depth the deterministic `review` step
  already gives a task, for every **non-terminal** member. A terminal member is inspected
  read-only in the cross-task pass only — no per-task "review" attempt is made against it
  (there is nothing to re-execute).
- Cross-task pass: for each pair of group members sharing a real relationship (dependency
  contract, shared file, shared `semantic_references.decisions`), inspect whether the root
  cause task's fix invalidates an assumption the other member's implementation still relies
  on. Produce a finding only for a real, concrete inconsistency. If the flagged member is
  terminal, the finding is `owner-decision-required`/`NEEDS_CLARIFICATION` (never an automatic
  fix attempt against it).
- A pair-inspection finding that identifies a non-terminal member needing adjustment calls
  `remediation-record.mjs`'s `addDiscoveredMember` (task 27's exported function) to add that
  member to the durable group record — this task never writes its own separate
  group-membership file (D36).
- Aggregate verdict: an explicit table (blocked > owner-decision-required > changes-required >
  pass, mirroring `computeMultiTaskReviewVerdict`'s own evaluation order).
- `suspensions` entries (task 27, D37) are cleared for every non-terminal group member if and
  only if the aggregate verdict is `pass`; a terminal member's advisory `suspensions` entry is
  cleared once any finding raised against it is resolved by the owner.

## Acceptance criteria

- A remediation group {t1 (root cause), t3 (fixed, non-terminal)} where t1's fix also
  invalidates an assumption in t2 (non-terminal, not originally in the group) is flagged: a
  structured finding cites t1's specific change, and t2 is added to the durable record via
  `addDiscoveredMember`.
  `automated: node --test tools/tests/dependency-invalidation-remediation-review.test.mjs`
- A remediation group including an already-`verified` member whose assumptions no longer
  hold produces an `owner-decision-required` finding for that member and does not attempt to
  reopen/re-execute it.
  `automated: node --test tools/tests/dependency-invalidation-remediation-review.test.mjs`
- A remediation group where every member's fix is genuinely consistent produces zero
  cross-task findings, an aggregate `pass` verdict, and clears every non-terminal member's
  `suspensions` entry.
  `automated: node --test tools/tests/dependency-invalidation-remediation-review.test.mjs`
- A remediation group with any unresolved per-task or cross-task blocking finding clears no
  member's `suspensions` entry.
  `automated: node --test tools/tests/dependency-invalidation-remediation-review.test.mjs`
- The aggregate verdict is computed from the explicit table, matching the worst individual
  finding's severity in every tested combination.
  `automated: node --test tools/tests/dependency-invalidation-remediation-review.test.mjs`

## Verification

```bash
node --test tools/tests/dependency-invalidation-remediation-review.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to the legacy `implementation-review` mechanism itself. Reviewing a normal,
non-invalidation batch of independently-ready tasks. Reopening a terminal task's workflow.
Any dashboard UI/route surface for triggering this review — this task exposes a callable
module only; `dashboard-orchestration-wiring` (task 32) wires it into the UI, reusing the
same checkbox/scheduling surface `deterministic-batch-orchestrator` already provides.
