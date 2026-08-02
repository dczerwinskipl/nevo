---
id: adr.0003-technical-decision-triage-and-option-analysis
type: adr
title: Adopt signal-based triage and mandatory solution-option analysis, without DDD apparatus
status: accepted
date: 2026-08-01
supersedes: ~
superseded_by: ~
---

# ADR-0003: Adopt signal-based triage and mandatory solution-option analysis, without DDD apparatus

## Status

Accepted

## Context

An external example repository (`ai-sdlc-from-scratch/01-ai-agent-instructions/pragmatic`)
was reviewed for ideas applicable to NEvo's AI-assisted SDLC process
([ADR-0002](ADR-0002-lightweight-markdown-workflow.md)). That repository builds a "Spec
Writer" workflow around a DDD (Domain-Driven Design) booking-system example: bounded
contexts, aggregate boundaries, domain archetypes, context maps, and an artifact
lifecycle keyed to business-ownership questions.

NEvo is a technical framework — it does not model a business domain, and most of that
apparatus (`instructions/core/ddd/**`, `context-map.md`, `c4.md` tied to bounded
contexts, "business meaning"/"actor" analysis) has no NEvo equivalent to attach to. But
underneath the DDD framing, two mechanisms in that repository are domain-agnostic and
were judged to meaningfully strengthen NEvo's own decision-support quality:

1. A **signal-based triage** procedure (evaluate a change against explicit yes/uncertain/
   no signals, classify from the result, escalate explicitly and one-way when a signal
   flips mid-work) — more auditable than judging change class (S/T/A/E) from
   free-form examples.
2. A **mandatory solution-option-analysis** step for architecture-gated decisions:
   present ≥2 meaningfully different options with real trade-offs, check for an existing
   library/BCL solution before proposing a custom one, run coupling/boundary checks, and
   — critically — when multiple options cost the same, state what each *unlocks* and
   *forecloses* rather than silently picking one.

## Decision

Adopt both mechanisms, reframed in purely technical terms (package boundaries, public
API surface, behavioral risk — not business ownership or domain semantics), and
integrate them into the existing workflow rather than bolting on a parallel process:

- The signal table and escalation rule extend the existing "Change classification"
  section of `docs/ai/specification-workflow.md` (vendor-neutral, so Cursor and Copilot
  benefit too, not just Claude Code).
- The option-analysis requirement — including the "do not default to the simplest
  option" principle and the consequences-at-equal-cost rule — is a new
  `## Solution option analysis` section in the same document, gated on the existing
  owner-approval list in `AGENTS.md`.
- Claude Code's `.claude/skills/nevo-ai-spec-workflow/references/triage-policy.md` and
  `references/solution-option-analysis.md` are thin execution-layer pointers into that
  shared document — they do not restate the policy, consistent with how the rest of the
  skill already avoids duplicating `docs/ai/specification-workflow.md`.

Explicitly **not** adopted: DDD tactical/strategic modeling instructions, bounded-context
mapping, the `decision.md`/`spec.md`/`context-map.md` artifact-lifecycle machinery with
per-artifact `source-of-truth`/`requires-approval` frontmatter and a mandatory
reconciliation pass. The source repository's own README describes that layer as
deliberately over-engineered "to showcase what happens when you keep adding structure
past the point where it stops paying off" — appropriate for a single-maintainer,
technical repository like NEvo only up to the two mechanisms above.

## Consequences

- `/nevo-ai:spec-create` and `/nevo-ai:spec-refine` classify changes against explicit
  signals instead of matching free-form examples, and must state which signal drove an
  escalation instead of silently absorbing scope creep.
- Any change touching an "Owner approval required" gate now requires ≥2 real options with
  trade-offs before a recommendation — a stricter bar than before, where a single
  proposed approach was acceptable as long as it was flagged for approval.
- The owner sees consequences ("this forecloses X, unlocks Y") for tied-cost decisions
  instead of an agent's unstated preference, matching the direction that AI supports the
  decision rather than making it.
- Slightly more agent output for architecturally-gated changes; small/local changes (all
  triage signals GREEN) are unaffected and stay lightweight.
- No new documents, statuses, or artifact types were introduced — this extends existing
  sections rather than adding a parallel schema, keeping `ADR-0002`'s "can be removed by
  deleting `docs/`, `specs/`, `tools/`, and the adapter files" property intact.
