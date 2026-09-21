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
  - tools/dashboard/server/specs/routes.mjs
  - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
  - tools/tests/dependency-invalidation-remediation-review.test.mjs
forbidden_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs/workflow/dependency-satisfaction.mjs
  - src/**
depends_on: [ dependency-release-and-invalidation, deterministic-batch-orchestrator ]
semantic_references:
  decisions: [D31]
---

# Task: Dependency-invalidation remediation review

## Goal

Implement D31's combined, cross-task-aware review pass for a dependency-invalidation
remediation group: after the group's fix attempts run (via `deterministic-batch-orchestrator`,
task 29), review the group as a whole — per-task reviews first, then a cross-task
consistency pass modeled on the legacy `implementation-review` mechanism's own two-pass
design (`references/review-policy.md` § "Multi-task implementation review") — and only clear
the group's suspension (task 28's `blockedBy` entries) once every member, including any added
during this review, passes.

## Implementation constraints

- New module tree, `tools/specs/workflow/remediation-review/**` — do not modify
  `tools/specs/lifecycle.mjs`'s legacy `implementation-review` code (forbidden path); adapt
  its two-pass *design* (file-overlap detection, bounded semantic-integration pairs, one
  aggregate verdict table) as a separate, `workflow_progress`-based implementation.
- Resolve scope from `dependency-release-and-invalidation`'s exported remediation-group
  derivation (task 28) — never a manually-typed task list.
- Per-task review: reuse whatever per-task review depth the deterministic `review` step
  already gives a task (bounded context per task); this task does not redefine what a
  correct implementation looks like, only adds the cross-task pass on top.
- Cross-task pass: for each pair of group members sharing a real relationship (dependency
  contract, shared file, shared `semantic_references.decisions`), inspect whether the root
  cause task's fix invalidates an assumption the other member's implementation still relies
  on. Produce a finding only for a real, concrete inconsistency — never a synthetic
  `INFORMATIONAL` entry for a pair with no actual conflict.
- A pair-inspection finding that identifies a member needing adjustment calls back into task
  28's exported derivation function to add that member to the group (if not already present)
  and applies the same suspension entry to it.
- Aggregate verdict: an explicit table (blocked > owner-decision-required >
  changes-required > pass, mirroring `computeMultiTaskReviewVerdict`'s own evaluation order)
  — never composed as prose.
- Suspension (`TaskProjection.blockedBy` `dependency-invalidated` entries, task 28) is
  cleared for every group member if and only if the aggregate verdict is `pass`.

## Acceptance criteria

- A remediation group {t1 (root cause), t3 (fixed)} where t1's fix also invalidates an
  assumption in t2 (not originally in the group) is flagged: a structured finding cites
  t1's specific change, t2 is added to the group and suspended.
  `automated: node --test tools/tests/dependency-invalidation-remediation-review.test.mjs`
- A remediation group where every member's fix is genuinely consistent produces zero
  cross-task findings, an aggregate `pass` verdict, and clears every member's suspension.
  `automated: node --test tools/tests/dependency-invalidation-remediation-review.test.mjs`
- A remediation group with any unresolved per-task or cross-task blocking finding does not
  clear suspension for any member.
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
non-invalidation batch of independently-ready tasks.
