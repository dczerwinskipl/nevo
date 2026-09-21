# Area: Dependency-invalidation remediation review

## Responsibility

Own the one combined, cross-task-aware review pass D31 requires for a dependency-invalidation
remediation group (`areas/dependency-release-and-invalidation.md`): after the group's fix
attempts run (via `areas/deterministic-batch-orchestrator.md`), review the group as a whole —
not each member independently — checking whether each member's implementation is still
consistent with the root cause task's now-updated implementation, flagging any member that
needs adjustment even if it wasn't part of the original fix round, and only then releasing
the group's suspension.

## Current state (grounded, 2026-09-21)

No deterministic-workflow equivalent of this exists. The legacy lifecycle already has a
comparable shape — `implementation-review` (`references/review-policy.md` § "Multi-task
implementation review", area `implementation-review-orchestration`): deterministic scope
resolution (`node tools/specs.mjs review-scope`), per-task review first (bounded context, one
fresh subagent per task), then two bounded cross-task passes — file-overlap detection
(`attributeTouchedPaths`/`detectBatchIntegrationFindings`) and bounded semantic-integration
pairs (`selectSemanticIntegrationPairs`, inspecting dependency contracts, semantic
references, shared schemas/state, producer/consumer relationships) — producing a finding
only for a real inconsistency, then one aggregate verdict from an explicit table
(`computeMultiTaskReviewVerdict`). This mechanism is legacy-lifecycle-specific (keyed to
`task.status`/`task-review`'s own flow) and is not directly reusable for
`workflow_progress`-based deterministic tasks, but its two-pass design is the proven pattern
this area adapts rather than re-deriving independently.

## Requirements

- **Scope = the remediation group.** Given a remediation group derived by
  `areas/dependency-release-and-invalidation.md` (root cause task + suspended dependents),
  resolve the group deterministically — no ad hoc task-list typing.
- **Per-task review first.** Each group member's fix attempt gets its own review at the same
  depth a normal deterministic `review` step would give it, bounded in context per task
  (adapt the legacy mechanism's "fresh context per task" discipline).
- **Cross-task consistency pass, required (D31).** After per-task reviews, inspect each
  member pair sharing a real relationship (dependency contract, shared file, shared
  `semantic_references.decisions`) for whether the root cause task's fix invalidates an
  assumption a member's implementation still relies on. A member found to need adjustment —
  even one not originally in the fix round — is flagged with a structured, explicit reason
  citing the specific root-cause change, and is added to the remediation group (extending
  `areas/dependency-release-and-invalidation.md`'s group), not silently passed.
- **One aggregate verdict.** Reuse the same top-to-bottom evaluation-table discipline
  `computeMultiTaskReviewVerdict` already establishes (blocked > owner-decision-required >
  changes-required > pass) rather than composing the verdict as prose.
- **Terminal group members get a finding, not a fix attempt (D31, corrected).** A group
  member that already reached `verified` is never reopened or re-executed — it is included in
  the cross-task consistency pass read-only; if its assumptions no longer hold, that produces
  an `owner-decision-required`/`NEEDS_CLARIFICATION` finding (reopening mechanics are a future
  decision, not solved here), never an automatic re-execution.
- **Only a fully-passing group clears its `suspensions` entries.** The remediation group's
  `suspensions` entries (`areas/dependency-release-and-invalidation.md`, D37 — never
  `blockedBy`) are cleared only once every non-terminal group member (including any added
  during this review) passes; a terminal member's advisory entry is cleared once its own
  finding, if any, is resolved by the owner.
- **Extends the durable record, not a parallel one (D36).** Adding a discovered member calls
  back into `areas/dependency-release-and-invalidation.md`'s exported function to append to
  the durable `.nevo-ai-local/remediation-groups/<change>/<remediationId>.json` record's
  `discoveredMembers` — this area never writes its own separate group-membership file.

## Constraints

- Does not replace or weaken a normal deterministic `review` step for non-invalidation flows
  — this area only applies to a derived remediation group.
- Does not reimplement `implementation-review`'s legacy code — adapts its two-pass design for
  `workflow_progress`-based tasks, own module.
- Never a synthetic/`INFORMATIONAL` finding for an inspected pair with no real inconsistency.

## Interfaces and boundaries

Exposes: the remediation-group review entry point (group task ids → per-task verdicts +
cross-task findings + aggregate verdict + suspension-clear decision).

Consumed by: the dashboard's remediation-group UI surface (reusing
`areas/deterministic-batch-orchestrator.md`'s checkbox/scheduling UI for running the group's
fix attempts, then this area's review once attempts complete);
`areas/dependency-release-and-invalidation.md` (suspension clearing, group extension).

## Area-specific acceptance criteria

- A remediation group of {t1 (root cause), t3 (dependent, fixed)} where t1's fix also
  invalidates an assumption in t2 (dependent, not originally in the fix round) is flagged:
  t2 gains a required-fix finding citing t1's specific change, and t2 is added to the group.
- A remediation group where every member's fix is actually consistent (no real
  inconsistency) produces zero cross-task findings and an aggregate `pass` verdict, clearing
  `suspensions` for every member.
- The aggregate verdict is computed from an explicit table, never composed as prose, and
  matches the worst individual per-task/cross-task finding severity.
- A terminal group member whose assumptions no longer hold produces an owner-facing finding,
  never an automatic reopen/re-execution of that task.

## Dependencies

`areas/dependency-release-and-invalidation.md` (the group signal this area consumes/extends),
`areas/deterministic-batch-orchestrator.md` (runs the group's fix attempts before this
area's review).

## Out of scope

Any change to the legacy `implementation-review` mechanism itself. Reviewing a normal
(non-invalidation) batch of independently-ready tasks — those continue through each task's
own `continuation: auto` review, not this area's combined pass. Reopening a terminal task's
workflow (deferred to a future decision if it ever proves necessary).
