---
id: nevo-ai-operational-workflow.add-review-handoff
status: implemented
change: nevo-ai-operational-workflow
context:
  required: []
  optional:
    - ../../../docs/adr/ADR-0004-review-artifacts-and-handoff.md
allowed_paths:
  - .claude/**
  - docs/ai/**
  - docs/adr/**
  - docs/development/git-workflow.md
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - specs/active/nevo-ai-operational-workflow/**
  - docs/index.generated.*
  - specs/*.generated.*
  - tools/specs.mjs
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - "*.csproj"
  - "*.sln"
  - Directory.Build.props
  - Directory.Packages.props
  - global.json
  - .github/workflows/**
  - tools/docs.mjs
  - specs/active/nevo-documentation-foundation/**
---

# Task: Make review a trustworthy workflow stage — artifact, verdict, re-review, approval gate

## Goal

Owner ran a real spec (`nevo-documentation-foundation`) through `/nevo-ai:spec-create`
and `/nevo-ai:spec-review` and hit, across several real runs, four compounding gaps in
the review workflow this task fixes together (each discovered from actual usage, not
speculatively):

1. **No persistence, no handoff.** A thorough analysis with no file, no fixed verdict
   vocabulary, and no next step — the owner had to interpret prose and act by hand.
2. **Verdict composed as prose, not derived.** A real report stated an unresolved
   blocking owner decision *and* "spec ready for owner approval" in the same response —
   two locally-plausible sentences nobody checked against each other.
3. **Stale re-review.** A re-review saw `git status` report the untracked spec
   directory, treated that as "nothing changed," and repeated already-fixed findings.
4. **`ready-for-approval` ended in a YAML-editing instruction.** The agent knew exactly
   which task, that every decision was resolved, and that the spec passed review — and
   still just told the owner to edit `change.yaml` by hand. `task-review`'s `pass`
   verdict had the same gap for `complete`/`verify`.

Fixed, respectively: a persistent single-current review file per change/task under
`specs/active/<change>/reviews/`; a five-value verdict decision table
(`blocked`/`owner-decision-required`/`changes-required`/`ready-for-approval`/
`approved-for-implementation`) with `ready_for_approval`/`implementation_allowed`
booleans as direct table output plus a pre-emit consistency check; a hard rule that a
re-review's baseline is the previous review file's own content — never git status/diff
— with findings gaining a `resolved`/`still-present`/`changed`/`cannot-verify`
lifecycle axis verified against exact, re-read predicates; and a new
`/nevo-ai:spec-approve` command (backed by a new `tools/specs.mjs approve` subcommand)
that asks the owner directly and writes `approved` only after an explicit answer, plus
the same ask-then-act treatment for `task-review`'s `pass` verdict. Findings are also
actor-classified (`AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION`/`NON_BLOCKING`/
`INFORMATIONAL`), and `tools/*.mjs check` (repo-wide, non-gating) is now explicitly
distinguished from `validate` (gating). Per owner instruction, the same closing-summary
shape (`Status`/facts/`Artifact`/`Next`) was applied to all seven `/nevo-ai:*` commands,
not only the review ones. Full reasoning and what was deliberately not adopted from the
source suggestions: [ADR-0004](../../../docs/adr/ADR-0004-review-artifacts-and-handoff.md).

## Dependencies

- `add-operational-layer` — extends the commands/skill that task created.

## Acceptance criteria

- `docs/ai/specification-workflow.md` has a "Review artifacts and handoff" section
  (actor classification, the `reviews/` file convention, the five-value verdict
  decision table with its consistency checks, the re-review baseline rule, gating vs.
  non-gating checks, and the approval-gate handoff) — vendor-neutral, so Cursor/Copilot
  benefit too.
- `docs/adr/ADR-0004-*.md` records all four fixes and what was deliberately not adopted
  (numbered review history with a sibling YAML resolution file; the
  `specs/changes/...` path, corrected to this repo's real `specs/active/...` schema).
- `references/review-policy.md` is the Claude-execution-layer source of truth for: actor
  categories, the artifact/handoff mechanics, the verdict decision table + consistency
  validation, the re-review baseline/lifecycle rules, gating vs. non-gating checks, and
  the confirm-then-act status-transition rule. Commands reference it, none duplicate it.
- `templates/review-report.md` matches: frontmatter (`verdict`, `ready_for_approval`,
  `implementation_allowed`, unresolved-finding counts), a `## Findings` table with
  category + lifecycle + predicate + evidence columns, and an implementation-readiness
  block.
- `SKILL.md` defines the shared closing shape once, with a `Status` vocabulary table
  covering all seven commands, and the "derived, not composed" rule for any command
  with more than two possible `Status` values.
- `/nevo-ai:spec-review`: reads its own previous `reviews/spec.md` as baseline before
  overwriting it (or states no baseline exists); never infers "unchanged" from git;
  computes its verdict from the decision table; runs gating (`validate`) and non-gating
  (`check`) checks with clearly separated labels; stays strictly read-only w.r.t. the
  change itself; ends with `Next: /nevo-ai:spec-approve` on `ready-for-approval`, never
  a YAML-editing instruction.
- `/nevo-ai:spec-approve <change-id> [task-id]` exists: confirms the latest review's
  verdict, asks a closed menu (approve only / approve and start / keep draft / show
  report), and writes `approved` (via `node tools/specs.mjs approve`) only after an
  explicit answer.
- `tools/specs.mjs` has a new `approve <change> <task>` subcommand mirroring
  `complete`/`verify`, with guard rails against re-approving or approving a task past
  that point — owner-approved before implementation.
- `/nevo-ai:spec-refine --from-review` (trailing `latest` accepted as a no-op) applies
  `AUTO_FIX` findings directly, stops at `OWNER_DECISION`/`NEEDS_CLARIFICATION`,
  recommends re-running `/nevo-ai:spec-review` afterward.
- `/nevo-ai:task-review`: same baseline/lifecycle re-review discipline as spec-review;
  verdict `pass`/`changes-required`/`blocked`; on `pass`, asks a closed menu
  (implemented / verified / leave as-is) and applies the chosen transition itself
  rather than printing a CLI command to type; never auto-applies code fixes.
- `/nevo-ai:spec-create`, `/nevo-ai:task-next`, `/nevo-ai:task-start` also end with the
  shared closing shape.
- `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/development/git-workflow.md` list
  `spec-approve` alongside the other commands/CLI subcommands.
- `node tools/docs.mjs validate` and `node tools/specs.mjs validate` pass.

## Out of scope

- Any change to `specs/active/nevo-documentation-foundation/` (the owner's own,
  separate, real spec that surfaced these gaps) — this task fixes the workflow, not
  that spec. Re-running `/nevo-ai:spec-review` against it is a natural follow-up.
- A numbered review-history scheme or a sibling per-finding resolution-tracking file —
  see ADR-0004 "What was deliberately not adopted."
- Any change to `tools/docs.mjs` behavior, or to `tools/specs.mjs` behavior beyond the
  one new `approve` subcommand.
