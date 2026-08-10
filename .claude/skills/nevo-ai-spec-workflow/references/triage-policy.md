# Triage policy (Claude execution layer)

The substantive policy — the signal table, classification rule, and escalation rule —
lives in [`docs/ai/specification-workflow.md`](../../../../docs/ai/specification-workflow.md)
under "Change classification" → "Signal-based classification" and "Escalation is
explicit and one-way". Read it there; this file does not restate it.

See [ADR-0003](../../../../docs/decisions/ADR-0003-technical-decision-triage-and-option-analysis.md)
for why this exists: extracted and adapted from an external DDD-oriented example
repository, reframed for a technical framework with no business domain to model.

## When Claude commands use this

- **`/nevo-ai:spec-create`**, Step 4 (classification): evaluate the signals, record the
  GREEN/YELLOW/RED rating and one-sentence reason for each in the classification report
  shown to the owner, and apply the classification rule.
- **`/nevo-ai:spec-refine`**: re-run the signal evaluation when refining reveals new
  information (e.g. discovery shows the change touches a public contract that wasn't
  obvious at spec-create time). If a signal flips from what was reported at creation,
  this is an escalation — follow the escalation rule, name the flipped signal explicitly
  to the owner, and do not silently absorb the new scope into the existing artifact
  structure without saying so.
- **`/nevo-ai:task-start`**: if, while preparing to start a task, the agent notices a
  signal that would change the task's classification (e.g. the task's scope has grown
  since the spec was written), stop before starting and report it — do not start
  implementation under an outdated classification.

## Execution note

Show the signal table in the classification report as an actual table (signal, rating,
one-sentence reason), not prose — it is meant to be auditable at a glance, and a future
`/nevo-ai:spec-review` pass needs to be able to check it without re-deriving it.
