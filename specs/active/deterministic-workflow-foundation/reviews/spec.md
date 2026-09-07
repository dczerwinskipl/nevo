---
review-of: spec
change: deterministic-workflow-foundation
generated: 2026-09-07
verdict: changes-required
ready_for_approval: false
implementation_allowed: false
unresolved_required_fixes: 2
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 86526416705a2bc8ab3c225903ca190896e81baa1784d44d07e6ed62bb970290
task_fingerprints:
  workflow-schema-and-compatibility: d738c1893138d7d069d04b9a419830f1895d7cb89a1a22eeb36b189fbb7c74f7
  composable-actions-and-contracts: 6a2a04e45ad6608eaaec3f1bc97ad11858471f515d02b8c77fc70efae5ec001a
  action-registry-and-aggregated-checks: 01b344de2df410fc722b37bc37b7b394af569447cfd1f70bdfd91b9d72666023
  deterministic-gates-and-human-verification: 04887f1a2aa260440ac97cf4c13e6e7d58edaa08bcda8c4919d600f1bfbb42fe
  source-control-capability: 57c683f9ec40fd1d2a052209c4bb3b409fe0a297f23afc8668b39cf7cc45b410
  step-orchestration-and-next-step-service: 9ef57e6dcdd331f72e1a93b055a7d70b62c70efc01b2df88926e3ce8837ce120
  cli-integration-and-vertical-poc: 3e4be0992da3d9f406344ca4483fe9e731d2e5f57c8c75fa590a03f3e12f83cd
---

# Review: deterministic-workflow-foundation

## Verdict

`changes-required` — two unresolved `AUTO_FIX` findings (a missing context reference and
a missing git-reconciliation primitive needed by Task 06's own specified recovery
behavior) block readiness. No owner decision or clarification is needed; both are small,
mechanical additions.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — Tasks 04, 06, 07 are
  `status: draft` (Tasks 01, 02, 03, 05 are `verified`, unaffected by this review).
- What has to happen first? Resolve F1 and F2 below.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | Task 06's `context.required` lists every module its own body text depends on for implementation | `tools/lib/git.mjs` is missing from Task 06's `context.required`, despite the task's own text calling `getCurrentRevision` directly and repeatedly invoking "the Task 04 local-Git reconciliation primitive (`tools/lib/git.mjs`)" for the `commit`/`push` recovery rules | Read `tasks/06-step-orchestration-and-next-step-service.md` front matter (`context.required`: `overview.md`, `owner-decisions.md`, the area doc, `contracts.mjs`, `registry.mjs`, `engine.mjs`, `cli-errors.mjs` — no `tools/lib/git.mjs`) against its own constraints bullets naming `getCurrentRevision` and the Task 04 reconciliation primitive by file path | `tasks/06-step-orchestration-and-next-step-service.md` |
| F2 | AUTO_FIX | first-review | Every acceptance criterion names a concrete, existing or specified mechanism sufficient to satisfy it | Task 06's `commit`-stage recovery rule (AC7, AC14) requires proving a candidate commit at HEAD was produced by this operation ("parent is `preCommitHead`, content matches `resolvedInputs`") — this needs a git capability to read a ref's parent SHA and message/subject. No such function exists in `tools/lib/git.mjs`, and no task names one as a deliverable: Task 04's only new primitive (AC7) checks "is SHA present on a remote branch" (for `push` reconciliation), which does not answer "what is this commit's parent/message" | Read `tools/lib/git.mjs` in full — exports `getWorkingTreeStatus`, `isWorkingTreeClean`, `branchExists`, `checkoutBranch`, `createAndCheckoutBranch`, `checkoutTrackingBranch`, `getDirtyFiles`, `getDirtyPaths`, `getWorkingTreeSummary`, `getCurrentBranch`, `getCurrentRevision`, `hasUpstream`, `getAheadBehind`, `commitAll`, `push`, `touchesPaths`, `getChangedFiles`, `getWorktreeDiff`, `findCommitsMentioning` — none returns a ref's parent SHA or message; cross-checked against Task 04's constraints/AC list (only the remote-presence primitive) and Task 06's own commit-recovery text (AC7, AC14) | `tools/lib/git.mjs`, `tasks/04-source-control-capability.md`, `tasks/06-step-orchestration-and-next-step-service.md` |

No `OWNER_DECISION` or `NEEDS_CLARIFICATION` findings.

Gating validation: passed (`node tools/specs.mjs validate`).
Non-gating repository check: passed (`node tools/specs.mjs check`, `node tools/docs.mjs check`).

## Specification quality assessment

Re-read `overview.md`, `owner-decisions.md` (D1-D19), both area docs, `change.yaml`, and
Tasks 01-07 in full, fresh, this run (per `references/review-policy.md` § "Re-review:
current file contents are the source of truth"). Findings beyond F1/F2:

- Tasks 01, 02, 03, 05 are byte-identical to their already-`verified` state — confirmed
  both by direct re-read and, independently, `git diff --stat` showing zero change since
  their last verification. Nothing in this review touches or re-grades them.
- The prior `reviews/spec.md` (generated 2026-08-18) describes a substantially superseded
  design (the original `next-step`/`execute-step` query service, `concrete-action-commit-and-push`
  as Task 04's id, no durable finish-operation model at all) and recorded zero findings —
  it provides nothing to carry forward for lifecycle classification, so F1/F2 are marked
  `first-review` rather than `still-present`/`resolved`. A full fresh evaluation was
  performed instead of trusting that baseline's "None" row.
- Independently verified that Task 02's already-`verified`, locked parameter-schema
  validator (`tools/specs/workflow/input-schema.mjs`) places no character restriction on
  a `requiredInputs` entry's `name` — confirming dotted names like `commit.title` are
  valid against the existing, verified contract; no locked task needs modification for
  the `commit.title`/`commit.message` design.
- The dependency graph is now correct: Task 06 depends on Task 04
  (`source-control-capability`) in `change.yaml`, matching its own stated reliance on the
  Task 04 action and reconciliation primitive; Task 07 depends on both.
- The `sourceControl` config's fail-closed rule (`remote.enabled: true` + `push: false` →
  validation error, never normalized) reads consistently across D12, C13, the area doc,
  and Task 04's constraints/AC9.
- The C18/C19 crash-recovery model (persisted per-stage intent, resolved-inputs
  persistence, `running`-state reconciliation) reads consistently across D14, C18/C19,
  the area doc, and Tasks 06/07's acceptance criteria at the *prose* level — F1/F2 were
  found by checking *implementability*, not prose consistency, and are the only gap of
  that kind found.
- `dependency_contracts` usage is inconsistent across this spec (Tasks 02/03/05 declare
  none despite real inter-task reliance; Task 06 now declares one for Task 04) — this
  matches this spec's own pre-existing, already-approved precedent for Tasks 02/03/05 and
  is not reopened as a finding here (D29's completeness check targets what a task's
  content actually relies on being *reference-integrity-checkable*, not a stricter
  standard than this same spec already shipped under).
- Ownership across Tasks 04/06/07 remains clean and non-overlapping: source-control
  action/config (04), step orchestration and durable execution (06), CLI integration and
  E2E (07) — no duplicated responsibility found.
- Acceptance criteria in Tasks 04/06/07 are individually testable with automated commands
  against dedicated fixture-based test files, with the one exception at F2.

## Next steps

1. Resolve F1 (add `tools/lib/git.mjs` to Task 06's `context.required`) and F2 (add a
   commit-parent/message-inspection primitive to Task 04's constraints and acceptance
   criteria — e.g. a `getCommitInfo(root, ref)` function returning
   `{ sha, parentSha, subject }` — and reference it from Task 06's commit-recovery text).
   Both are small, mechanical additions, not a redesign.
2. Re-run `/nevo-ai:spec-review deterministic-workflow-foundation`.
