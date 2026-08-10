---
id: nevo-ai-operational-workflow.add-technical-decision-support
status: implemented
change: nevo-ai-operational-workflow
context:
  required: []
  optional:
    - ../../../docs/adr/ADR-0003-technical-decision-triage-and-option-analysis.md
allowed_paths:
  - .claude/**
  - docs/ai/**
  - docs/adr/**
  - AGENTS.md
  - specs/active/**
  - specs/archive/**
  - docs/index.generated.*
  - specs/*.generated.*
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
  - tools/**
---

# Task: Add technical decision-support (triage + solution-option analysis)

## Goal

Owner reviewed an external, DDD-oriented example repository
(`ai-sdlc-from-scratch/01-ai-agent-instructions/pragmatic`) and asked to extract the
non-domain-specific value into NEvo's workflow: (1) signal-based change classification
with explicit, one-way escalation, replacing judgment-by-example for S/T/A/E; (2)
mandatory solution-option analysis for architecture-gated decisions, with a
"do not default to the simplest option" principle and a rule that ties in cost must
surface consequences (what each option unlocks/forecloses) rather than being decided
silently. The goal is that the agent supports the decision, never makes it.

Explicitly do not port the DDD apparatus itself (bounded contexts, aggregate
boundaries, domain archetypes, context maps, the `decision.md`/`spec.md` artifact
lifecycle with per-file `source-of-truth`/`requires-approval` frontmatter) — NEvo has no
business domain for that machinery to attach to. See ADR-0003 for the full reasoning.

## Dependencies

- `add-operational-layer` — this task extends the skill/commands/workflow doc that task
  created.

## Acceptance criteria

- `docs/ai/specification-workflow.md` contains the signal table, classification rule,
  and escalation rule under "Change classification", and a full "Solution option
  analysis" section (options framing, existing-solution check, evaluation dimensions,
  complexity sizing, coupling/boundary checks, consequences-at-equal-cost rule,
  recommendation rule, confirmation menu).
- `docs/adr/ADR-0003-technical-decision-triage-and-option-analysis.md` exists and passes
  `node tools/docs.mjs validate`.
- `.claude/skills/nevo-ai-spec-workflow/references/triage-policy.md` and
  `references/solution-option-analysis.md` exist, point to the shared policy doc rather
  than duplicating it, and their relative links were verified against actual path
  resolution (not assumed) after PR #12 flagged link-resolution as a review risk area.
- `templates/solution-options.md` exists as an artifact-shape guide.
- `SKILL.md`, `references/decision-policy.md`, `references/discovery-policy.md`,
  `references/artifact-policy.md`, `references/review-policy.md` are updated to
  reference the new mechanisms without duplicating them.
- `.claude/commands/nevo-ai/spec-create.md`, `spec-refine.md`, `spec-review.md`, and
  `AGENTS.md` are updated to use triage/option-analysis at the appropriate step.
- `node tools/docs.mjs validate` and `node tools/specs.mjs validate` pass; generated
  indexes are regenerated and current.

## Out of scope

- Any DDD-specific instruction content (aggregate boundaries, domain archetypes,
  context maps, bounded contexts).
- The artifact-lifecycle/reconciliation-pass machinery from the source repository
  (per-file `source-of-truth`/`requires-approval` frontmatter, mandatory reconciliation
  report) — judged over-engineered for a single-maintainer technical repository; see
  ADR-0003 "Consequences".
- Any change to `tools/specs.mjs` / `tools/docs.mjs` behavior (that happened separately,
  as an owner-approved bug fix responding to PR #12 review, not as part of this task).
