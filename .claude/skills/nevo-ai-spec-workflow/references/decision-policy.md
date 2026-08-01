# Decision policy

This references the owner-approval model in `AGENTS.md` ("Decision policy") and
`docs/ai/specification-workflow.md` ("Owner approval gates") — it does not restate that
list. This document is about the *operational mechanics* of presenting and recording
decisions, not about which decisions require approval.

## How to present options

For each decision needed:
- State the question in one sentence.
- Give the meaningful options (not an exhaustive enumeration of every conceivable
  variant) with their real trade-offs.
- Note which option is least reversible, if that differs from the recommended one.

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
