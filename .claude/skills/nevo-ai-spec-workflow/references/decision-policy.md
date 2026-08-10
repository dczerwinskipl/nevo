# Decision policy

This references the owner-approval model in `AGENTS.md` ("Decision policy") and
`docs/ai/specification-workflow.md` ("Owner approval gates") — it does not restate that
list. This document is about the *operational mechanics* of presenting and recording
decisions, not about which decisions require approval.

The agent supports the decision; it does not make it. Concretely: do not converge on a
single proposed approach and present it for a yes/no rubber-stamp when the decision is
gated — see `references/solution-option-analysis.md` for the full option-analysis
requirement (minimum two real options, do not default to the simplest, state
consequences when costs tie). This file covers the smaller, everyday decisions that
don't rise to a full option analysis but still need the owner's explicit answer.

## How to present options

For each decision needed:
- State the question in one sentence.
- Give the meaningful options (not an exhaustive enumeration of every conceivable
  variant) with their real trade-offs.
- Note which option is least reversible, if that differs from the recommended one.
- If the decision is gated per `AGENTS.md` / `docs/ai/specification-workflow.md` §
  "Solution option analysis", use that fuller procedure instead of an ad hoc list.

## Confirmation menu

When asking the owner to confirm a recommended direction (gated or not), prefer a
closed set of choices over an open-ended question — it's faster to answer and easier to
record:

```
1. Yes, use this option.
2. No, revise the options.
3. Re-analyze with different priorities.
4. I want to provide my own direction.
```

Adapt the wording to the decision at hand; keep the four-way shape (accept / revise /
re-analyze / owner's own direction).

## How to state a recommendation

Give exactly one recommended option and the reason. A recommendation is a suggestion,
not a decision — never act on it as if the owner had already agreed, and say so
explicitly ("recommendation, not yet decided").

## How to record owner decisions

Once the owner responds, record it using `templates/owner-decisions.md`: decision ID,
question, options considered, the actual decision, rationale if given, consequences, and
which artifacts it affects. This record travels with the change (in its spec directory),
not just in conversation — later commands (`spec-refine`, `task-review`) need it without
replaying the whole discussion.

## What may not be inferred

- Silence is not agreement. An unanswered question stays open, it does not default to
  the recommended option.
- A decision made for one change does not silently apply to a different change, even a
  similar one — ask again, referencing the precedent as context.
- Do not infer a decision from an old commit, an old spec, or code shape alone — those
  are evidence for a recommendation, not a substitute for the owner's answer.

## How to handle unanswered questions

List them explicitly as open in the discovery/review output. A specification with
unresolved decisions that block a task is not ready for implementation — say so, don't
paper over it with a plausible-sounding default.

## Preventing suggestions from becoming requirements

Never write a recommendation directly into a spec's acceptance criteria before the owner
has approved it. Draft acceptance criteria are clearly marked as proposed until the
owner decision that confirms them is recorded.

## Classifying open questions and assumptions

For every open question, classify it as:
- **Blocking** — must be answered before acceptance criteria can be finalized or a
  solution option selected,
- **Non-blocking** — affects details but not the option choice; can be deferred,
- **Implementation detail** — safe to decide during implementation.

For every assumption the agent is about to rely on, classify it as:
- **Low-risk** — standard behavior, safe to proceed,
- **High-impact** — affects scope, acceptance criteria, or the option choice; must be
  stated explicitly rather than silently assumed,
- **Temporary** — valid for now but must be confirmed before implementation,
- **Unsafe** — convert to an open question instead of proceeding on it.

Never silently convert a Blocking open question into an assumption to keep moving. If
the owner can't answer it yet, record it as unresolved along with the risk of proceeding
without it — that is itself a valid, honest output of a discovery or refine pass.
