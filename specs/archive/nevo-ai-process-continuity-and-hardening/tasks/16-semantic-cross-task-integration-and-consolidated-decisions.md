---
id: nevo-ai-process-continuity-and-hardening.semantic-cross-task-integration-and-consolidated-decisions
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - implementation-review-orchestration
  - review-report-compaction-and-scope-exceptions
  - deterministic-implementation-provenance
semantic_references:
  decisions: [D18, D30, D31, D34, D35]
  constraints: [C1, C2, C4]
  dependency_contracts:
    - implementation-review-orchestration
    - review-report-compaction-and-scope-exceptions
    - deterministic-implementation-provenance
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/implementation-review-orchestration.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - .claude/commands/nevo-ai/implementation-review.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/skills/nevo-ai-spec-workflow/references/decision-policy.md
    - tools/specs/lifecycle.mjs
  optional:
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/tests/semantic-integration.test.mjs
  - .claude/commands/nevo-ai/implementation-review.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
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

# Task: Semantic cross-task integration and one consolidated decision stage

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.
> Requested after task 12 reached `verified`. Extends task 12's area (§ "Semantic
> integration and consolidated decisions") rather than reopening or rewriting task 12's
> own body.

## Goal

Closes D34 property 9 (one consolidated owner interaction after multi-task review) and
property 6 (no repeated review of unchanged work — a bounded, targeted semantic pass,
not a second full re-read). Extends `/nevo-ai:implementation-review`'s cross-task
integration pass beyond literal file-overlap to the eleven semantic signal categories in
`areas/implementation-review-orchestration.md` requirement 16, completes each per-task
reviewer's structured return data (requirement 19), and collapses owner/scope decisions,
follow-up choices, and the bulk-transition confirmation into one consolidated stage
(requirement 21) — never a per-task prompt of any kind.

## Dependencies

`implementation-review-orchestration` (task 12) — extends its cross-task integration
pass and per-task structured-data contract; cannot exist before task 12's own command
and functions do.

`review-report-compaction-and-scope-exceptions` (task 13) — the scope-decision
collection (task 13's own aggregate-report requirement 18) this task folds into the
same consolidated stage as owner decisions and the bulk-transition menu.

`deterministic-implementation-provenance` (task 15) — `computeImplementationFingerprint`,
now wired to real data, is the source of the implementation-fingerprint field this
task's structured per-task return requires.

## Implementation constraints

- Extend `detectBatchIntegrationFindings` (or add a sibling function reusing its
  overlap detection as one of several signal checks) to cover the eleven categories in
  area requirement 16. Each category is a targeted, bounded check over identified
  pairs/components (requirement 16's own pair-selection rule: existing file-overlap
  detection, plus any pair sharing a `semantic_references.dependency_contracts`/
  `decisions` entry) — never a full re-read of every task's diff a second time.
- Do not add any code path that re-computes or re-reads an individual task's own
  acceptance-criteria coverage inside the integration pass (area requirement 17,
  unchanged from task 12's own requirement 7 boundary).
- A signal category that, on inspection, finds no real conflict produces no finding —
  never a synthetic `INFORMATIONAL` entry (area requirement 18).
- Extend the per-task structured object returned by each `task-review` run inside
  `implementation-review.md`'s loop (area requirement 19) with: `pendingOwnerDecisions`,
  `pendingScopeDecisions`, `clarificationRequests` (each a distinct list, never folded
  into the blocking-finding count), `followUpCandidates`, and
  `implementationFingerprint` (via `computeImplementationFingerprint`, task 15). The
  existing fields (task ID, verdict, AC covered/total, blocking findings, review
  artifact path) are unchanged.
- Per-task review steps must not gain any new prompt — requirement 20's rule (no
  per-task owner-facing question of any kind) is a hard constraint on this task's own
  changes, not just a restatement of task 12's existing rule. Concretely, this task
  changes `implementation-review.md` so that a step-7a-eligible follow-up candidate,
  surfaced during a per-task run inside `implementation-review`'s own orchestration, is
  collected into that task's structured return (`followUpCandidates`) instead of
  presented inline — offered once, for every task together, at the consolidated stage
  (area requirement 20). `task-review` run standalone is unaffected: its own step 7a
  offer stays exactly as task 12 originally shipped it, per task, unchanged.
- Replace `implementation-review.md`'s existing end-of-run confirmation (task 12's
  requirement 11, as already extended by task 13's requirement 18 for scope decisions)
  with the single consolidated stage (area requirement 21): collected owner/scope
  decisions first, then optional follow-up choices, then the bulk-transition menu — all
  in the same turn, all before any `change.yaml` write.
- Do not introduce a new finding category or per-task verdict value (unchanged from
  task 12/13).

## Acceptance criteria

1. A fixture pair of tasks sharing a `semantic_references.dependency_contracts`/
   `decisions` entry — even with no file overlap — is selected for inspection by
   `selectSemanticIntegrationPairs`
   (`automated: node --test tools/tests/semantic-integration.test.mjs`). Whether an
   inspected pair's actual content produces a real semantic-integration finding is a
   model-review judgment (the eleven signal categories, area requirement 2) with no
   code representation, by design — corrected 2026-08-08 (owner decision): the original
   wording claimed this outcome itself was `(automated)`, which is not achievable for a
   judgment step.
2. A fixture pair touching the same signal category (e.g. both editing CLI help text)
   with no real conflict is still selected for inspection but produces no finding of any
   kind — selection alone carries no verdict/classification field (automated); never a
   synthetic `INFORMATIONAL` entry. Whether a genuinely clean pair produces zero findings
   in practice is the same model-review judgment named in AC1 — corrected 2026-08-08,
   same reason as AC1.
3. The integration pass never re-derives or re-reports an individual task's own AC
   coverage as an integration finding (automated + inspection).
4. Each per-task structured return carries `pendingOwnerDecisions`,
   `pendingScopeDecisions`, `clarificationRequests`, `followUpCandidates`, and a
   non-null `implementationFingerprint` once a persisted `implementation` provenance
   block (task 15) exists for that task (automated).
5. No per-task prompt (status, follow-up, owner decision, or scope decision) occurs
   between individual task reviews in a multi-task run — every decision surfaces only
   at the consolidated stage (automated, via a fixture asserting zero intermediate
   prompts across a 3+ task scope).
6. The consolidated stage presents required owner/scope decisions, optional follow-up
   choices, and the bulk-transition menu together, in that order, in one turn — a test
   proves the three parts are computed from the same run and rendered in one response
   (automated + inspection).
7. `implementation-review.md`'s existing per-task verdict values
   (`pass`/`changes-required`/`blocked`) and finding taxonomy are unchanged (inspection).
8. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
   report clean after this task's doc edits (automated).
9. `node --test tools/tests/*.test.mjs` (full suite, including the new
   `semantic-integration.test.mjs`) passes (automated).

## Verification

```
node --test tools/tests/semantic-integration.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` § "Multi-task
implementation review" (the eleven signal categories and the consolidated-stage shape),
`.claude/commands/nevo-ai/implementation-review.md`,
`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new subsection covering
D34/D35's semantic-integration and consolidated-decision extension; "Context" paragraph
names task 16 alongside tasks 01-15).

## Out of scope

- Re-grading any individual task's own acceptance criteria inside the integration pass
  (unchanged boundary from task 12).
- A fourth per-task verdict value, or a new finding category beyond what
  `references/review-policy.md` already defines.
- Changing `/nevo-ai:task-review`, `/nevo-ai:spec-audit`, or the gating batch review's
  own report/prompt shape.
- Reopening or rewriting tasks 01-15's own task/area files.
