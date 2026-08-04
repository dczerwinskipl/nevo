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
  - specs/active/nevo-documentation-architecture/**
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
- Write the new ADR under `docs/decisions/` (next available number after ADR-0005),
  covering D7 (fingerprint tiers), D8 (execution suspension vs. new statuses), D9
  (post-merge sequencing), D10 (derived batch state), D3 (approve+start combined
  confirmation), and — second refinement pass — D16 (status vocabulary removal), D17
  (repair-and-retry inside combined transitions), D18 (deterministic
  `semantic_references`), D19 (batch evidence freshness), D20 (four-mode batch
  selection), D21 (task 08's dependency on task 06), D22 (structured `follow-ups.yaml`),
  and D23 (diagnostic anchor with a guarded repair-branch step).
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
   D19, D20, D21, D22, D23 (inspection).
4. The terminology inventory and derived-vs-persisted state inventory both appear in
   `docs/ai/specification-workflow.md` (inspection).
5. `node tools/specs.mjs check` and `node tools/docs.mjs check` report generated indexes
   as current after this task's edits (automated).
6. `node --test tools/tests/` (the full suite, including task 10's) still passes after
   this task's doc-only edits (automated — proves nothing was accidentally broken by a
   doc change touching a code comment or similar).

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
