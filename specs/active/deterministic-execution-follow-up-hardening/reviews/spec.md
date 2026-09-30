---
review-of: spec
change: deterministic-execution-follow-up-hardening
generated: 2026-09-30
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 802d642a2af16f230e680def34ea2e7ddf09e6c0cef0465c7f3db91c2c703d59
task_fingerprints:
  shared-finish-operation-replayability-classifier: c6d5a71ed8aca99a0b5ea01207d7b5c07ba02151076573bdd8349267ce672b36
  readiness-classification-split: cc7364bf83708e1a6629772ea5b1f19151c7c43a5c1aaada1aa995598bacd450
  non-fatal-admission-for-remediable-blockers: 0a2abdc0021a284707d7108c9c6a5349bf17b32f4bc0ed7f57a650c8d8bb23b3
  remediation-protocol-exception: dec68008373003a0fe7a6579fe922b0acf50694b900a239d507ce33370ae9b3b
  three-outcome-terminal-classification: 131532f205ed6095550fac407d47eb5f8c95f704f88419676b126fb61df7e80f
  terminal-reconciliation-adopts-outcome: 6c80f9bf3bb11d469b86501364e79af70310a3d1046ae228df7b2018b7965193
  dependency-consumption-idempotent-on-resume: 5c29607cc23c6042e02eb09503497839e17ff8377ca2bf96f637ea2dd8e7dcf1
  resume-and-terminal-audit-trail: 82456d7ca9c8a5b6b8edcbb47060a3d4fe06aecdf6daf39618cfd32fdb891b33
  admission-ownership-model-adr: f1162e152c05f813f130b4ebbe1848a99c29319cebbc67b6eb84bbab64e3bb27
  acceptance-scenario-a: b5879e69a06271b220f8cf3aedb80e88c07e1861966e6f43e6963ed63c14934a
  acceptance-scenario-b-and-c: ce29a16116ac92ce6550d5184224e6d805df8f3a25b4bf38fd4b87c09b74fd41
  acceptance-scenario-d-regression: aea7aadef3e135802fe61aacbbb62d1f8362addf41eaf81e9687290d38528e8e
  acceptance-scenario-finish-operation-replay: e628b48d5634902e16178c0d8b76a84cd7d3c2a7f73af155fcced6deadf79158
---

# Review: deterministic-execution-follow-up-hardening

Baseline: the prior `reviews/spec.md` (verdict `owner-decision-required`, F1–F7 + F3b),
read in full before being overwritten. Since that review, the spec underwent a substantial
refinement: F1/F2/F3/F3b/F4/F5/F6/F7 were applied, and a further owner-directed correction
extended D2's replayability rule symmetrically to terminal settlement classification
(previously flagged only as an unaddressed observation), adding a new foundational task
(`shared-finish-operation-replayability-classifier`) and a new acceptance task
(`acceptance-scenario-finish-operation-replay`), and renumbering all task files
(01→02, ..., 11→12) to make room. Task **IDs** (the stable identifiers `depends_on`
references) are unchanged throughout — only file numbers/`order` shifted.

## Verdict

`ready-for-approval` — every prior finding resolved, no new blocking finding from this
run's independent fresh pass.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false` (no task is yet
  `status: approved`).
- Are the relevant tasks `approved` in `change.yaml`? No — all 13 tasks are `status: draft`.
- What has to happen first? Nothing blocking remains; run `/nevo-ai:spec-approve`.

## Findings

### Baseline findings — verified against current content, all resolved

| ID | Category | Lifecycle | Predicate (as originally recorded) | Verified current state |
|---|---|---|---|---|
| F1 | AUTO_FIX | resolved | `outcome: 'completed'` conflated "genuinely advanced" with "never activated" | `owner-decisions.md` D1 amended; `resumable` now explicitly covers the never-activated sub-case in `overview.md`, `areas/terminal-execution-classification-and-resumability.md`, and `tasks/05-...md`'s acceptance criteria (verified: `completed` bullet now reads "the *only* case this outcome now covers") |
| F2 | OWNER_DECISION | resolved | `FINISH_OPERATION_UNRESOLVED` uniformly activation-only | `owner-decisions.md` D2 amended per owner's option 1 with the replayability semantic; `tasks/02-...md` and `tasks/03-...md` both implement the split via a shared classifier |
| F3 | AUTO_FIX | resolved | `tasks/02` (now `03`) missing `depends_on: terminal-reconciliation-adopts-outcome` | Verified: `change.yaml` and `tasks/03-non-fatal-admission-for-remediable-blockers.md` both list it |
| F3b | AUTO_FIX | resolved | `tasks/05` (now `06`) missing `depends_on: dependency-consumption-idempotent-on-resume` | Verified: `change.yaml` and `tasks/06-terminal-reconciliation-adopts-outcome.md` both list it |
| F4 | AUTO_FIX | resolved | `tasks/09` (now `10`) missing an abandoned-remediation acceptance criterion | Verified: `tasks/10-acceptance-scenario-a.md` now has the "Abandoned-remediation variant" bullet |
| F5 | AUTO_FIX | resolved | `admission.mjs`'s `subscribeToSession` failure silently swallowed, not in any task | Verified: `tasks/03-...md`'s Implementation constraints and two acceptance criteria now cover it explicitly |
| F6 | AUTO_FIX | resolved | No task corrects the false `forbidden_paths` "fails closed" doc claim | Verified: `tasks/04-remediation-protocol-exception.md`'s Goal/constraints/acceptance criteria now cover it, doc-only, no enforcement scope creep |
| F7 | AUTO_FIX | resolved | No task declared `semantic_references.decisions` despite citing D-numbers | Verified: all 13 current tasks now carry `semantic_references`; cross-checked every literal `D[1-6]` citation in each task body against its declared `decisions` list — exact match in all 13 (one gap, `tasks/03`, found and closed during this run's own fresh check — see below) |

### This run's own fresh pass (independent of the baseline)

- **Semantic-reference completeness (step 5a), run fresh across all 13 current tasks:**
  found `tasks/03-non-fatal-admission-for-remediable-blockers.md` cited D1 in its
  Dependencies section ("D1 amendment") without declaring it in `semantic_references.decisions`
  (only `[D2]`). Corrected to `[D1, D2]` before this report was written — verified no
  further gaps by cross-referencing every literal `D[1-6]` occurrence in each task body
  against its declared list (exact match, all 13 tasks).
- **D2's symmetry correction — verified against actual code, not just the spec's own
  claim:** read `finish-operation.mjs` in full. Confirmed `planFinish`/`finishStep` already
  treat an in-flight operation record as authoritative regardless of which execution
  resumes it (`D23` comment, "authoritative over re-deriving the step") — so the spec's
  claim that no new admission-side resume mechanism is needed for a replayable
  finish-operation record to be picked back up is accurate, not assumed. Confirmed
  `ensureUpdateTask`'s three-way reconciliation (write-definitely-happened /
  write-definitely-did-not-happen / state-inconsistent) is what actually produces
  `status: 'blocked'` — i.e. "ambiguous" is a real, already-computed signal, not something
  this spec has to invent.
- **Dependency graph re-verified acyclic after the renumbering + new task insertion:**
  `node tools/specs.mjs validate` passes; manually traced every edge
  (01,07 roots → 02,05 → 06 → 03 → 04,08,09,11,13 / 10 / 12) — no cycle, and the specific
  danger pattern the owner flagged (an agent-visible capability shipping before the
  classification logic that keeps it safe) is closed at every point checked, including the
  new task: `13` (the finish-operation-replay acceptance test) depends on `03` and `06`,
  so it cannot be exercised before either half of D2's symmetry lands.

### Non-blocking observations (do not block approval)

| ID | Category | Note |
|---|---|---|
| N1 | NON_BLOCKING | `tasks/06-terminal-reconciliation-adopts-outcome.md`'s acceptance criteria still say "gains the same `resumable`-releases-cleanly behavior for the active-but-not-ambiguous case" (singular) — `resumable` now has three sub-cases, not one; the phrase is imprecise, not incorrect (the `cli-manual` takeover path realistically only ever encounters the active-mid-flight or replayable-finish sub-cases, never the never-activated one, since CLI takeover implies a step was already started). Cosmetic wording only. |
| N2 | NON_BLOCKING | `tasks/06` does not have a `depends_on` edge to `tasks/03` (non-fatal admission). Not unsafe — `tasks/06` alone never misclassifies anything (it only ever makes settlement *more* correct, never wrongly blocks something that previously worked) — but the full "agent admitted at a replayable finish operation → resumes cleanly" round trip isn't exercisable end-to-end until both land. An optional edge for landing-order tidiness, not a correctness requirement like F3/F3b were. |

## Gating validation

`node tools/specs.mjs validate` — passed (29 changes). `node tools/docs.mjs validate` —
passed (75 documents).

## Non-gating repository check

`node tools/specs.mjs check` — indexes current. `node tools/docs.mjs check` — indexes
current.
