---
review-of: spec
change: deterministic-status-architecture
generated: 2026-09-20
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 5938c4f4fa9060548be734351e2b4feaf1b47cbcb6d5b47bc7bf72535bbe3e74
task_fingerprints:
  legacy-mutation-guard: 95b032872677163ce7af2ef4ce9a07b879924508efcfeb396f45ca9ddad955e8
  deterministic-mutation-guard: bcfadd6a91fa7af1f3adf7596f497764df769a7f639344d165b330fbe005109e
  status-vocabulary-extraction: 30356c55deeef286f6d426498dc6bbbbce5303da7884e9e5449236e120b06ed8
  lifecycle-boundary-regression-tests: b09635077cc398d1abfee7b441414f0889322dbe7b3b128f5624968d2fe53038
  workflow-task-publish-operation: eb5ca8a1556d37f260d614ca4eaa7ca9000d321c9b1e5b5110a75a971945f947
  deterministic-cli-default-task-resolution: 7ecd54203da388c4f7780b0c59c88687e7423b368a66e314f0389dacd9582157
  workflow-definition-schema-extensions: 5f13740a520a9a8474397a15b026f212855e9da954cf45feeb2f875d354daf0c
  step-executor-guard: 0f19c9024543f35c9eb7dbef9e886115b981a7c1c2b278bc66541b18ab25ed26
  human-step-execution-operations: 7aa1f12a9d90bcdb7ccbcb51bc6f1567d54c103a82e4e919c7484fb8444d3295
  human-step-projection: 6d37cef2e093580c06b07faeee0e0ed699aac3bd76443dab012b1ffebafe5362
  deterministic-dependency-satisfaction: 14dee95ca92eeb6f8127ce2cdffa1cd26868cca4a4003c43addce3483cffcd52
  deterministic-task-projection: f69ef76c4a85717f6453f8d28ed80fee6cb4699b409ebe1cb46a4a907c155554
  execution-readiness-policy: 21adde80225e527fe099acfeaefdf07a66578643cfe930de315e7dbdbc49dbb3
  dashboard-deterministic-action-projection: 9ee7007e29f006f77d6f5d42e00d39da05f9a3a3b3a9a2361d471dc44913ac3a
  session-bootstrap-readiness-wiring: 5a5230e89f1872b2ddbfcec55797617673c4b7e8318388fc359677596d00d46c
  dashboard-human-step-transport: cba2c8b20ed807cb73afcfda0aa8f1d4dd1285fa3ef733520fb97806c94fc0f0
  dashboard-actions-lifecycle-split: 9bed806ba90212065b7b4517df12afa696fd385d47d6899c44ba1e489d38f1f7
  deterministic-board-lane-projection: 4180fb263235849f05e34861837d9feec26b29be7efc02c3ac05a9b3976072ff
  task-card-lifecycle-split: bf93b259ed3580f75f6ddb77b474744de9a86c7a15ea6419d4e3fdf825f4827b
  human-step-surface-consolidation: 444efe67acf2166ea4e64b9d560bdc48230f3078771f9c9b3e7756e4e342a56d
  lifecycle-skill-instruction-split: bc5bce489b1e3b4266152f4831776fa236323364bf7ee1b4c7d9ae10d95ff693
  ownership-boundary-documentation: ebe5cb1c58368fe615e4d91225674cf651b534e3ec4cebb69eaca8612be79155
  specification-detail-composition-wiring: 27bec5b4ac1e61fad748c6b1525c7130c93ea5b17fcc5e902b5e8b9b47984c07
---

# Review: deterministic-status-architecture

## Verdict

`ready-for-approval` — no unresolved findings of any kind remain; the relevant tasks are
not yet `status: approved` in `change.yaml`, so implementation may not start yet (row 4 of
the decision table).

No reliable previous-file baseline is available. Performing a fresh review of the current
specification.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No — all 23 tasks are currently
  `status: draft`.
- What has to happen first? Nothing further from this review — the owner's explicit
  approval via `/nevo-ai:spec-approve` (never inferred from this verdict alone).

## Scope

`--all` — every task (order 1–23) read fresh in full, alongside `overview.md`,
`owner-decisions.md` (all 20 decisions, D1–D20), and all 11 `areas/*.md` files.

## Gating and non-gating checks

```
Gating validation: passed
  node tools/specs.mjs validate — Validated 27 changes — no errors.
  node tools/docs.mjs validate — Validated 75 documents — no errors.
Non-gating repository check: passed
  node tools/specs.mjs check — Specs valid and indexes are current.
  node tools/docs.mjs check — Indexes are current.
```

## Findings

No findings. (See "Corrections applied during this review" — real defects were found and
corrected in the same pass that produced this report, before this file was written; none
remain open.)

## Corrections applied during this review

This review found and corrected two classes of real, `AUTO_FIX`-category defects — both
unambiguous, mechanical, and scope/behavior-neutral — before computing the final verdict
above. Documented here for the audit trail, not as open findings:

1. **Missing semantic-reference declarations (D26/D29).** Eleven tasks' prose named a
   decision (`D1`, `D5`, `D7`–`D11`, `D13`, `D14`, `D16`–`D19`) their frontmatter
   `semantic_references.decisions` did not declare — confirmed by comparing every
   `D<n>` mentioned in each task's body against its declared list, then verifying each
   mention's context individually before adding it. Fixed: `03-status-vocabulary-extraction.md`
   (added `D8`, plus the `semantic_references` block itself, which was entirely absent),
   `07-workflow-definition-schema-extensions.md` (`D16`),
   `09-human-step-execution-operations.md` (`D11`, `D13`, `D16`),
   `10-human-step-projection.md` (`D16`), `12-deterministic-task-projection.md` (`D8`,
   `D9`), `13-execution-readiness-policy.md` (`D19`),
   `14-dashboard-deterministic-action-projection.md` (`D18`),
   `18-deterministic-board-lane-projection.md` (`D1`),
   `19-task-card-lifecycle-split.md` (`D7`, `D10`),
   `20-human-step-surface-consolidation.md` (`D14`, `D16`), and
   `23-specification-detail-composition-wiring.md` (`D5`, `D14`, `D17`, `D18`).
2. **Dangling `D37` reference (three instances).** `areas/deterministic-projection-and-human-step.md`,
   `areas/step-executor-model.md`, and `tasks/12-deterministic-task-projection.md` each
   cited a decision `D37` — but this specification's own `owner-decisions.md` only
   defines `D1`–`D20`; `D37` does not exist here. Traced to `overview.md`'s own,
   correctly-namespaced reference to `D18`/`D37` in the **archived**
   `specs/archive/deterministic-workflow-foundation/owner-decisions.md` — a different
   document, whose own D37 the owner has separately, explicitly disputed as not
   reflecting genuine deliberated approval (`overview.md` itself already says so). Citing
   it here, unqualified, as if it were this spec's own settled decision would have been
   doubly wrong. Fixed by removing the bogus `D37` citation from all three locations and
   stating the underlying fact (the engine's existing `state: active|completed` model)
   directly, with no decision-number attribution — it was never this change's decision to
   begin with, it is grounded, pre-existing engine behavior.

Both corrections were re-verified after application: a full `D<n>` mention-vs-declaration
comparison across all 23 tasks now shows zero gaps in either direction (nothing mentioned
and undeclared, nothing declared and unmentioned), a repository-wide grep for `D37` inside
this spec returns zero matches, and `node tools/specs.mjs validate`/`node tools/docs.mjs validate`
both pass clean against the corrected content.

## Specification readiness criteria (checked directly, not assumed)

- Every task intended to start next has `status: approved`: **not yet** — this is exactly
  what gates `implementation_allowed: false` above; nothing else about the spec blocks it.
- `depends_on` references resolve and are acyclic: **yes** — `node tools/specs.mjs validate`
  confirms this mechanically, and the dependency graph was additionally traced by hand for
  the four tasks most recently restructured (15 → 19/20/23) — no cycle, no
  consumer-before-producer edge.
- `allowed_paths`/`forbidden_paths` present and unambiguous for every task: **yes** —
  confirmed by reading every task's frontmatter; every referenced path was independently
  verified to exist in the real repository (`tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx`,
  `.../specification-overview.tsx`, `tools/dashboard/ui/features/specifications/detail/status-board.tsx`,
  `.../tasks/task-dialog.tsx`, `tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx`,
  `.../agent-session-chat-surface.tsx`, `.../queries.ts`), with no duplicate file created
  under the wrong path.
- Acceptance criteria are testable: **yes** — every criterion across all 23 tasks names
  either an `automated:` test command or a concrete `inspection:` check; none is
  aspirational language with no verifiable predicate.
- No owner decision needed for the next task is still open: **yes** — task 1
  (`legacy-mutation-guard`, the next dependency-ready task) has no open owner-decision
  finding.
- Documentation impact identified: **yes** — `docs/development/agent-workflow-protocol.md`
  (task `ownership-boundary-documentation`) and the shared skill's reference files (task
  `lifecycle-skill-instruction-split`) are both explicitly in scope.
- Option analysis for gated decisions: **n/a, explicitly recorded** — `owner-decisions.md`
  D1 records that the owner supplied the target architecture directly; `overview.md` §
  "Options and trade-offs" states this explicitly rather than silently omitting the usual
  option-comparison shape.
- Every task's `semantic_references` is complete: **yes, after correction** — see
  "Corrections applied during this review" above.

## Architecture and documentation

No diff to compare against `docs/development/` yet (this is a specification, nothing has
been implemented). The specification's own documentation-impact tasks (22, 21) are scoped
correctly against the current, real content of `docs/development/agent-workflow-protocol.md`
and `.claude/skills/nevo-ai-spec-workflow/SKILL.md`.
