# Solution option analysis (Claude execution layer)

The substantive policy lives in
[`docs/ai/specification-workflow.md`](../../../../docs/ai/specification-workflow.md)
under "Solution option analysis" — the "do not default to the simplest option"
principle, the option framing (Minimal change / Balanced improvement / Target shape),
infrastructure-pattern recognition, evaluation dimensions, complexity sizing, coupling
and package-boundary checks, the consequences-at-equal-cost rule, and the recommendation
rule. Read it there; this file does not restate it.

See [ADR-0003](../../../../docs/decisions/ADR-0003-technical-decision-triage-and-option-analysis.md)
for why this exists and, just as importantly, what was deliberately **not** adopted from
the source material (DDD bounded-context modeling, the `decision.md`/`context-map.md`
artifact-lifecycle machinery) — this is the technical-decision subset only.

## When this triggers

Run this whenever a change is classified **T or larger** (see `triage-policy.md`) *and*
touches one of the "Owner approval required" items in `AGENTS.md` (public API shape,
package dependency direction, new external dependencies, transaction semantics,
persistence ownership, message processing behavior changes, breaking changes,
compatibility decisions, new packages/projects, CI/CD changes). Do not run it for
changes that don't touch one of those gates — a **T** change that only extends
internal middleware behavior in an established pattern does not need option analysis.

## Which commands use this

- **`/nevo-ai:spec-create`**: after discovery, before presenting owner decisions — this
  *is* how owner decisions on architecture-gated questions get presented. Use
  `templates/solution-options.md` as the artifact shape when writing options to the
  spec; present the same content in conversation regardless of whether it's written to
  disk.
- **`/nevo-ai:spec-refine`**: when refinement reveals a gated concern that the original
  spec didn't surface options for, run this before proposing the refinement.
- **`/nevo-ai:spec-review`**: check that a spec touching a gated concern actually
  contains an option analysis with the consequences rule applied, not just a single
  proposed approach — flag it as a blocking finding per `references/review-policy.md` if
  missing.

## Execution notes

- Do not skip straight to a recommendation. The owner must see the options — including
  the rejected ones and why — not just the conclusion.
- The confirmation menu at the end of `docs/ai/specification-workflow.md`'s "Presenting
  for confirmation" section should be presented to the owner in whatever language they
  are using in conversation; the four options themselves (accept / revise / re-analyze
  with different priorities / owner provides direction) stay fixed.
- Do not generate `tasks/` files or an implementation plan in the same turn the options
  are first presented, unless the owner has already approved a direction earlier in the
  same conversation.
