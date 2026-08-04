---
id: nevo-ai-process-continuity-and-hardening.workflow-docs-and-adr-migration
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/overview.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - docs/ai/specification-workflow.md
    - AGENTS.md
    - CLAUDE.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/commands/nevo-ai/spec-review.md
  optional:
    - docs/decisions/ADR-0002-lightweight-markdown-workflow.md
    - docs/decisions/ADR-0003-technical-decision-triage-and-option-analysis.md
    - docs/decisions/ADR-0004-review-artifacts-and-handoff.md
    - docs/decisions/ADR-0005-deterministic-approval-and-hardened-guard.md
allowed_paths:
  - docs/ai/specification-workflow.md
  - AGENTS.md
  - CLAUDE.md
  - docs/decisions/*.md
  - .claude/commands/nevo-ai/*.md
  - .claude/skills/nevo-ai-spec-workflow/**
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
  - specs/archive/nevo-documentation-architecture/**
  - tools/**
---

# Task: Workflow docs, ADR, and consistency migration

> New task, split from the original combined wrap-up task per the refinement's finding
> 12. Runs only after task 10's cross-mechanism E2E tests are green — this task describes
> proven behavior, it never introduces or papers over an untested mechanism.
>
> Refined again 2026-08-04 (second pass) — the terminology inventory gains four more
> one-term-per-concept entries the second refinement pass introduced (semantic
> reference, evidence freshness, batch selection mode, diagnostic anchor), and the ADR
> now also covers D16-D23.
>
> Refined a third time 2026-08-04 — see D24, D25, D26. This task gains a new
> implementation-bearing requirement it did not have before (every earlier requirement
> was pure documentation of already-tested code): adding the `semantic_references`
> completeness model-review step to `references/review-policy.md`/
> `.claude/commands/nevo-ai/spec-review.md`, since task 01 cannot touch those files under
> its own `forbidden_paths`. This is a procedural addition (a model-review instruction),
> not a code mechanism, so it is not gated behind task 10's automated-test-first rule the
> way this task's other doc updates are — see the implementation constraint below for why.
> The terminology inventory gains two more entries (hard stop condition, reference
> completeness vs. reference integrity), and the ADR now also covers D24-D26.
>
> Refined a fourth time 2026-08-04 — see D29. The completeness-check finding
> categorization (below) is tightened: a missing, load-bearing reference is never
> `NON_BLOCKING` — `AUTO_FIX` when unambiguous, `OWNER_DECISION` when ambiguous;
> `NON_BLOCKING` is reserved for an unnecessary (not missing) reference. The ADR list
> gains D27-D29.

## Goal

Fix the `docs/ai/specification-workflow.md:61` classification-rule contradiction; bring
every touched doc/command/skill file into agreement with what tasks 01-10 actually built
and tested, using one consistent term per concept; write the recommended ADR; regenerate
generated indexes.

## Dependencies

`workflow-e2e-tests` — this task documents and finalizes the tested system; it must not
run first.

## Implementation constraints

- Remove the contradiction at `docs/ai/specification-workflow.md:61` in favor of the
  signal-based classification table beneath it — ambiguity routes to **E** (discovery
  first), not a blanket "prefer the smaller class."
- Apply one consistent term per concept throughout every touched file — do not call the
  same thing a "status" in one document and a "blocker" in another:
  - **lifecycle status** — the stable `status` field (`draft`/`approved`/.../terminal).
  - **execution suspension** — the orthogonal `execution.suspension` block (D8); never
    called a status, a blocker alone, or a lifecycle state.
  - **owner decision** — an entry in `owner-decisions.md`.
  - **review status** — a review file's `verdict` (spec/task/batch/audit).
  - **batch state** — the persisted intent file's contents (D10) plus derived progress;
    never called "batch status" (that phrase is reserved for a task's own `status`).
  - **retry target** — `execution.suspension.previous_action`.
  - **recommended action** — `deriveStage`'s `nextCommand` output.
  - **semantic reference** (D18, second refinement pass) — an entry in a task's
    `semantic_references` block (`decisions`/`constraints`/`dependency_contracts`);
    never called a "dependency" alone, since `depends_on` can express pure ordering
    without a semantic reference.
  - **evidence freshness** (D19) — whether a batched task's recorded evidence (automated
    or inspection) is still current given later batch changes; never called "evidence
    validity" or conflated with the task's own acceptance-criteria verdict.
  - **batch selection mode** (D20) — one of the four named modes
    (`currently-ready`/`all-approved-reachable`/`named-subset`/`until-checkpoint`);
    never called "batch scope" (reserved for the broader authorized-scope concept that
    also includes a single named task).
  - **diagnostic anchor** (D23) — the preserved merged branch after a post-merge
    verification failure; never called a "recovery anchor" (D9's original term,
    corrected by D23 because the branch does not itself repair `main`).
  - **hard stop condition** (D24, third refinement pass) — a batch failure (failed/
    unresolved self-check, failed acceptance criterion, failed automated verification,
    unrefreshable stale evidence, missing required evidence, or a verification-blocking
    implementation error) that halts the batch immediately and that a full
    `task-review` can never substitute for; distinct from a **full-review risk signal**
    (D11), which is evaluated only after a task's self-check has already passed.
  - **reference integrity vs. reference completeness** (D26, third refinement pass) —
    integrity is whether a declared `semantic_references` entry exists/is active/is not
    duplicated, checked deterministically by `validateSpecs`; completeness is whether
    the declared list covers everything the task's content actually depends on, checked
    by a model-review step inside `/nevo-ai:spec-review`. Never conflate the two — a
    task can pass integrity checks while still being incomplete.
  - **missing vs. unnecessary reference** (D29, fourth refinement pass) — a *missing*
    load-bearing reference blocks approval (`AUTO_FIX` if unambiguous,
    `OWNER_DECISION` if ambiguous); an *unnecessary* (declared but not load-bearing)
    reference may stay `NON_BLOCKING`. Never describe a missing reference as merely
    "worth noting" — it blocks by default unless resolved.
- For every transition state, document: the CLI operation that validates it, the command
  or controller action that invokes it, whether confirmation is required, and whether it
  can be combined conversationally with the previous transition (per D2/D3's "combined
  transitions" rule: underlying transitions stay separate and auditable, state is
  re-inspected between them, a successful earlier transition is never rolled back when a
  later one fails).
- Include an explicit derived-vs-persisted state inventory, at minimum: task lifecycle
  status (persisted), active suspension (persisted), active batch intent (persisted),
  current/completed/next/failed task (derived), review freshness (derived from
  fingerprint comparison), available/recommended action (derived via `deriveStage`),
  worktree status (derived via git), current branch (derived via git).
- Only update docs/commands/skill files that describe a mechanism task 10 actually proved
  works — do not describe anything task 10 didn't test.
- **Semantic-reference completeness model-review step (D26, third refinement pass;
  categorization tightened by D29, fourth refinement pass).** Add an explicit step to
  `.claude/skills/nevo-ai-spec-workflow/references/review-policy.md` (and wire it into
  `.claude/commands/nevo-ai/spec-review.md`'s flow) reading, in substance: for every
  task, inspect its goal, constraints, acceptance criteria, context rules, and path
  rules; identify every owner decision, shared constraint, and dependency contract the
  task's content actually relies on; compare that against the task's declared
  `semantic_references`; report any missing, stale, or unnecessary reference as a
  finding. **Categorization (D29):** a missing, load-bearing reference is never
  `NON_BLOCKING` — `AUTO_FIX` when it's unambiguous which reference is missing,
  `OWNER_DECISION` when ambiguous which one applies; `NON_BLOCKING` is reserved for an
  unnecessary (declared but not load-bearing) reference. A spec carrying an unresolved
  missing-reference finding cannot reach `ready-for-approval` — state this explicitly;
  no new verdict-table row is needed, the existing table (`docs/ai/specification-
  workflow.md`) already stops at an unresolved `AUTO_FIX`/`OWNER_DECISION` finding, only
  the categorization feeding into it changes. State explicitly that this whole check is
  separate from, and does not replace, `validateSpecs`'s deterministic reference-
  integrity checks (task 01) — this step exists specifically because schema validation
  cannot detect an omission. This is a procedural/model-review instruction, not a code
  mechanism task 10 tests automatically (see the refinement note above) — its own
  correctness is verified by inspection (acceptance criterion below), not `node --test`.
- Write the new ADR under `docs/decisions/` (next available number after ADR-0005),
  covering D7 (fingerprint tiers), D8 (execution suspension vs. new statuses), D9
  (post-merge sequencing), D10 (derived batch state), D3 (approve+start combined
  confirmation), — second refinement pass — D16 (status vocabulary removal), D17
  (repair-and-retry inside combined transitions), D18 (deterministic
  `semantic_references`), D19 (batch evidence freshness), D20 (four-mode batch
  selection), D21 (task 08's dependency on task 06), D22 (structured `follow-ups.yaml`),
  D23 (diagnostic anchor with a guarded repair-branch step), — third refinement
  pass — D24 (batch hard-stop/risk-signal split), D25 (ordered, truthful repair-branch
  guards), D26 (semantic-reference completeness model review), and — fourth refinement
  pass — D27 (corrected task-addition/removal fingerprint invalidation), D28 (persisted
  `self_check` schema), and D29 (missing-reference categorization tightening).
- `AGENTS.md`/`CLAUDE.md` updates stay pointer-level, consistent with their existing
  scope — do not duplicate `docs/ai/specification-workflow.md` content into them.
- Regenerate `docs/index.generated.*`/`specs/*.generated.*`/`docs/routing.generated.json`
  as a direct, mechanical consequence of this task's own doc edits — declared in
  `consequential_paths`, run and commit as part of this task, not deferred.

## Acceptance criteria

1. `docs/ai/specification-workflow.md` no longer contains the line-61 contradiction
   (inspection).
2. Every `.claude/commands/nevo-ai/*.md` file touched by an earlier task in this change
   has its behavior description updated to match, using the one-term-per-concept mapping
   above (inspection, cross-checked against tasks 01-10's actual changes).
3. A new ADR exists under `docs/decisions/` covering D3, D7, D8, D9, D10, D16, D17, D18,
   D19, D20, D21, D22, D23, D24, D25, D26, D27, D28, D29 (inspection).
4. The terminology inventory and derived-vs-persisted state inventory both appear in
   `docs/ai/specification-workflow.md` (inspection).
5. `node tools/specs.mjs check` and `node tools/docs.mjs check` report generated indexes
   as current after this task's edits (automated).
6. `node --test tools/tests/` (the full suite, including task 10's) still passes after
   this task's doc-only edits (automated — proves nothing was accidentally broken by a
   doc change touching a code comment or similar).
7. `references/review-policy.md` and `spec-review.md` state the `semantic_references`
   completeness check explicitly — what it inspects, what it compares against, and how
   a finding is categorized — and state explicitly that it is separate from
   `validateSpecs`'s reference-integrity checks, not a replacement for them (inspection)
   (D26).
8. `references/review-policy.md`/`spec-review.md` state that a missing, load-bearing
   reference is never `NON_BLOCKING` (`AUTO_FIX` when unambiguous, `OWNER_DECISION` when
   ambiguous) and that an unnecessary reference may stay `NON_BLOCKING`, and that a spec
   with an unresolved missing-reference finding cannot reach `ready-for-approval`
   (inspection) (D29).

## Verification

```
node --test tools/tests/
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/ai/specification-workflow.md`, `AGENTS.md`, `CLAUDE.md`,
`.claude/commands/nevo-ai/*.md`, `.claude/skills/nevo-ai-spec-workflow/**`, a new
`docs/decisions/ADR-0006-*.md` (or next available number).

## Out of scope

- Any change to `nevo-documentation-architecture`'s own artifacts.
- New runtime mechanisms or new tests beyond what regenerating indexes requires — this
  task is documentation, ADR, and index regeneration only.
- Building automated tooling that detects a missing `semantic_references` entry — D26's
  completeness check is a documented model-review instruction for `/nevo-ai:spec-review`
  to follow, not a code mechanism this task implements.
