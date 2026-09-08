# Area: Multi-Step Workflow Orchestration

## Purpose

Close the gap between what Tasks 01-07 actually proved (one workflow step's full
lifecycle, including a multi-*stage* durable finalize sequence) and this
specification's actual target: a workflow *definition* with several distinct steps —
conceptually `implementation -> review -> quality -> human-approval -> complete`, or any
other configured sequence — driving an agent through all of them via repeated `workflow
step start` / `workflow step finish` cycles, with the workflow definition (never the
agent, never hardcoded engine logic) deciding what happens next at every step boundary.

This area covers Tasks 08-12. See D18-D22 in `owner-decisions.md` for the decisions
behind it, and `overview.md` §14 for the summary of what's already good (unchanged) vs.
what's genuinely new.

**D18 is flagged for owner confirmation** (persistence-ownership gate, `AGENTS.md`) —
Task 08 is written assuming the recommended option (Git-tracked `workflow_progress`);
see D18 for the alternative and what would need to change if the owner prefers it.

## 1. Why task `status` cannot represent step progress (D18)

`task.status` (`draft`/`approved`/`in-implementation`/`implemented`/`verified`) already
carries meaning independent of the deterministic engine: `depends_on` satisfaction
(`DEPENDENCY_SATISFYING_STATUSES`), `approve`'s human-signoff gate, archival eligibility,
and every legacy command's own state machine (`validateTransition` in
`lifecycle-primitives.mjs`). A multi-step deterministic workflow needs a *second*,
independent axis — "which of this workflow's several steps is the task currently on" —
that has nothing to do with any of that. Inventing a `status` value per intermediate
step would make `status` mean two unrelated things depending on `workflow.mode`, and
would break the moment a specification needs both a real multi-step workflow *and*
today's status-driven dependency/approval semantics at the same time (which every
deterministic-mode change already does, since `depends_on` and dashboard displays are
`workflow.mode`-agnostic).

## 2. `workflow_progress` — persisted step position (D18)

New optional field on a task's `change.yaml` entry, meaningful only when the change's
`workflow.mode` is `deterministic`:

```yaml
tasks:
  - id: my-task
    status: in-implementation      # unchanged legacy-compatible coarse lifecycle marker
    workflow_progress:
      current_step: review          # a key in the resolved workflow definition's `steps` map
      history:
        - step: implementation
          completed_at: "2026-09-08T10:00:00Z"
          transitioned_to: review
```

- `current_step` is the authoritative pointer `resolveCurrentStepName`'s replacement
  reads. Absent (a task that has never advanced past its workflow's first declared
  step) resolves to the definition's *entry step* — the first key in the `steps` YAML
  mapping, an ordering convention already implicit in how `schema.mjs`/`engine.mjs`
  treat step maps, not a hardcoded name.
- `history` is an append-only audit trail (each entry written by the same `update-task`
  finalize-stage write that advances `current_step`) — useful for the same reason
  `implementation.changed_paths`/`review_revision` already are: reconstructing what
  happened without re-deriving it from Git log archaeology. Minimal shape; extend only
  if a concrete future need requires it — no speculative fields.
- Validation (`tools/specs/validation.mjs`): `current_step`, when present, must name an
  actual step in the task's resolved workflow definition — a task record can never point
  at a step its own definition doesn't declare. Meaningless (and rejected) on a task
  whose change is not `workflow.mode: deterministic`.
- Written by the same `update-task` finalize stage (Task 06) that already writes
  `task.status`, in the same `change.yaml` read-modify-write, so it lands in the same
  progress commit as the implementation (C14 unchanged, generalized).

## 3. Transition-target resolution: step name vs. terminal status (D19)

A step's `transitions: [{ to: X }]` is resolved against the *current* workflow
definition's own `steps` map keys first:

- **`X` matches a declared step name** → this is an internal, workflow-scoped
  transition: write `workflow_progress.current_step = X` (append a `history` entry),
  leave `task.status` untouched.
- **`X` matches no declared step name** → this is the terminal case, exactly as today's
  single-step `standard.yaml` (`to: verified`) already behaves: write `task.status = X`,
  and clear/finalize `workflow_progress` (the workflow is done; `current_step` no longer
  applies).

This requires no new schema field on `transitions` itself and is fully backward
compatible — re-derive today's exact behavior as the degenerate one-step case. A
definition must not declare a step whose name collides with a terminal status value used
elsewhere as a `to` target in the *same* definition (validation error, not a silent
"advance to the step" resolution when a terminal write was intended) — Task 08 adds this
check.

## 4. Fail-closed action/gate resolution (D20)

`step-context.mjs`'s `aggregateFinalizeCheck` currently filters a step's `finalize` list
down to already-registered actions (`registeredFinalizeActions`) before calling
`WorkflowEngine.checkStep` — introduced during Task 06 specifically to tolerate
`.nevo-ai/workflows/standard.yaml`'s reference to the never-implemented
`verify-task-output` action. This violates the fail-closed principle C6 already
established for action *inputs*, one level up: a configured-but-unregistered action
reference should never let the workflow silently run as a smaller, different workflow
than the one declared.

**Fix (Task 09):**
- Remove `registeredFinalizeActions`'s filtering — pass the full `finalize`/`actions`
  list through to `WorkflowEngine.checkStep` unfiltered.
- `loadWorkflowDefinition` (`definitions/loader.mjs`) is called with `knownActions`
  populated from the real, already-registered `ActionRegistry` (`defaultActionRegistry.list()`
  — this requires the action-registration side effect, `import './actions/index.mjs'`,
  to have already run before load), so `validateWorkflowDefinition`'s existing
  `validateActionReference({ knownActions })` check rejects an unregistered action id at
  **load time**, not silently at aggregation time. (Gate types were already validated at
  schema-load time via `KNOWN_GATE_TYPES` — this closes the one remaining silent path,
  which was action-side only.)
- Remove `verify-task-output` from `.nevo-ai/workflows/standard.yaml`'s `finalize` list.
  It was always a placeholder with no registered implementation; if a real
  output-verification action is ever needed, it is implemented as a genuine, registered
  `ActionContract` and re-added deliberately — never left as an unregistered reference
  "tolerated" by the engine.
- Any test fixture definition (Task 06/07's own `.nevo-ai/workflows/vertical-poc.yaml`-
  style test YAML) that referenced `verify-task-output` for illustrative purposes drops
  it too, since it would now fail to load.

## 5. Production-quality multi-step `standard.yaml` (Task 10)

Today's `standard.yaml` is a single-step placeholder (`implementation -> verified`) that
exists to prove the *engine*, not to be Nevo's real Standard-change workflow. Task 10
replaces it with a genuine multi-step sequence — each step independently declaring its
own `entryGates`/`actions`/`exitGates`/`finalize`/`transitions`. **Exact step names,
count, and gate composition are Task 10's own implementation decision**, not fixed by
this area doc — informed by Nevo's existing review/verification practice (the legacy
`approve`/self-check/human-verification concepts this specification's D16 migration map
already names), but not prescribed here. A illustrative (non-binding) shape, matching
the kind of sequence the owner described when commissioning this correction:

```yaml
steps:
  implementation:
    exitGates: [{ type: command, action: test }]
    finalize: [{ id: commit-and-push }]
    transitions: [{ to: review }]
  review:
    entryGates: []
    exitGates: [{ type: human, required: true, role: reviewer }]
    finalize: [{ id: commit-and-push }]
    transitions: [{ to: complete }]
  complete:
    transitions: [{ to: verified }]
```

Whoever starts Task 10 must record the real step decomposition as its own decision
entry (`owner-decisions.md`) before implementing it, per this skill's decision-policy —
this area doc intentionally does not pre-select it.

## 6. `StepContext` knowledge/skill/file hints (D22, Task 11)

`overview.md` §7's original `StepContext` example (predating Task 06's implementation)
showed `instructions` and `expectedWork.allowedPaths`; the implemented
`compileStepContext()` never carries them. Task 11 adds them back, sourced
deterministically — never inventing new engine-level prompt generation:

- `expectedWork`: the task's own `allowed_paths`/`forbidden_paths`, already loaded
  wherever the legacy context packet (`tools/specs/context.mjs`'s `buildContextPacket`)
  is built for the same task — reused, not re-derived.
- `instructions`: a short, structurally-derived summary (e.g. "work within
  `expectedWork.allowedPaths`; N entry blocker(s) outstanding") — not a free-form
  AI-authored paragraph.
- Relevant-docs hints: whatever routing-rule matching `tools/specs/context.mjs` already
  computes against the task's `allowed_paths` for the legacy context packet (`docs.mjs`
  routing), surfaced structurally (doc ids/paths), not restated as prose.

This is additive to `StepContext`'s shape — existing consumers/fields are unaffected.

## 7. Real multi-step end-to-end proof (Task 12)

A fixture workflow definition with **at least three** distinct steps (names are the
fixture's own choice, not fixed here) must prove, via CLI calls only (no manual
`change.yaml`/task-file edits, no direct gate/action API calls — same discipline as
Task 07's own vertical PoC):

- `workflow step start` resolves step A for a fresh task.
- Finishing A (`workflow step finish`) writes `workflow_progress.current_step = B` in
  the same commit as the implementation, and the *next* `workflow step start` call
  resolves B, not A again.
- Each step's gates are evaluated only for that step — a gate configured on B must not
  affect finishing A, and vice versa.
- Finishing B moves to C.
- C's entry or exit gate includes a `HumanVerificationGate`; `step finish` against C
  reports it blocked; only `workflow verify-human --confirm` satisfies it; a subsequent
  `step finish` then completes C.
- Finishing C reaches the terminal case (`to` matching no declared step) — `task.status`
  is written, `workflow_progress` is finalized, and the next `step start` reports the
  workflow already complete (mirroring Task 06's existing terminal-state handling,
  generalized).
- Retry/resume semantics (Task 06 AC6-AC14) hold for **each individual step's** finish
  operation independently — an interruption during step B's finalize must not affect
  step A's already-completed, already-committed progress.
- No test in this suite drives a transition by calling internal resolution functions
  directly in place of `workflow step finish` — the CLI surface is what's exercised.
- The same test file, given a *second*, differently-shaped fixture definition (different
  step names/count), produces a correspondingly different sequence through the exact
  same CLI code path — demonstrating the engine contains no Standard-specific or
  fixture-specific sequencing.
