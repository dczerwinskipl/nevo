# Area: Multi-Step Workflow Orchestration

## Purpose

Close the gap between what Tasks 01-07 actually proved (one workflow step's full
lifecycle, including a multi-*stage* durable finalize sequence) and this
specification's actual target: a workflow *definition* with several distinct steps —
conceptually `implementation -> review -> quality -> human-approval -> complete`, or any
other configured sequence — driving an agent through all of them via repeated `workflow
step start` / `workflow step finish` cycles, with the workflow definition (never the
agent, never hardcoded engine logic) deciding what happens next at every step boundary.

This area covers Tasks 08-12. See D18-D27 in `owner-decisions.md` for the decisions
behind it, and `overview.md` §14 for the summary of what's already good (unchanged) vs.
what's genuinely new.

**D18 is approved** (owner, 2026-09-08): `workflow_progress` is Git-tracked `change.yaml`
task state (Option 3), not runtime-local storage — it is long-lived workflow/domain
progress, unlike the finish-operation record's transient, single-call crash-recovery
state (D14).

This area doc was itself revised once, after a second review found five further gaps in
the first draft of Tasks 08-12 (§§8-12 below, D23-D27) — finish-operation identity
wasn't step-aware, human-verification sign-off wasn't step/gate-scoped, workflow
definitions had no way to tell the agent what a *specific* step expects, nothing checked
workflow-definition version compatibility, and the schema silently tolerated more than
one transition per step while an entry step was only an implicit convention. §§1-7 below
are the first draft's content (still correct); §§8-12 are the additions.

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

## 8. Step-aware finish-operation identity (D23, Task 08)

Today's durable finish-operation record path,
`.nevo-ai-local/workflow-operations/<change>/<task>.json`, is keyed only by task — fine
for one step, wrong for several. Once step A finishes and its record shows
`status: completed`, step B's `planFinish`/`finishStep` must never load *that same file*
and conclude B is already done.

**Fix:** the record path becomes step-aware —
`.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json`. `loadOperationRecord`/
`saveOperationRecord` (`finish-operation.mjs`) gain a `step` parameter, threaded through
from the already-resolved current step (D19's resolution already happens before either
function is called, so the step name is always in hand). This makes the invariant
structural, not merely logical:

- a finish operation belongs to exactly one workflow step (its file path says so);
- a previous step's `completed` record is a different file, unreachable from the current
  step's resolution path — it can never short-circuit a later step;
- retrying the *same* step resolves the *same* path → same operation, resumes exactly as
  D14 already proved;
- advancing to a *different* step resolves a *different* path → nothing to load → a
  fresh operation is created for it;
- nothing deletes or overwrites a completed step's file — it simply stops being read
  once the task has moved on, which is what "preserve previous operation history" means
  here: each step's own file *is* its history, with no separate archival mechanism
  needed.

**Required regression test (Task 08, exercised again end-to-end in Task 12):** step A
finishes (`completed`); step B then starts and finishes; assert B's finish actually runs
B's finalize sequence (produces its own commit/result) rather than short-circuiting to
"already completed" from A's leftover record.

## 9. Step/gate-scoped human-verification identity (D24, Task 08)

`FileHumanVerificationStore` (Task 07) persists one confirmation per `(change, task)`.
With more than one independently-configured `HumanVerificationGate` across steps (or,
rarely, more than one within the same step), that model would let confirming any one of
them silently satisfy all of them — a real hole in C8 ("an agent cannot self-satisfy or
bypass a human verification gate"; an operator confirming the *wrong* gate is a milder
but still real version of the same problem).

**Fix:** key the persisted signoff by the full configured identity —
`change` + `task` + `step` + gate identity (`gateDisplayId` — e.g. `human-review`, or a
gate's own explicit `id`) + `requiredRole` (the gate's configured `role`, default
`owner`). Storage path:
`.nevo-ai-local/human-verifications/<change>/<task>/<step>/<gate-id>.json`.
`workflow verify-human <change> <task> --confirm` keeps its current ergonomics —
auto-resolving the current step exactly as `step start`/`step finish` do — and adds an
optional `--gate <id>` for the rare case where a step has more than one unmet human gate
and disambiguation is required (fail closed rather than guessing which one the operator
means). Every existing invariant is preserved: the agent has no code path that writes
this file; `verify-human` is the one, separate operator command; the record is
file-backed and durable across process invocations (`HumanVerificationGate.inspect`/
`.verify`, Task 05, are unchanged — only how *this* CLI-facing store keys its own file
changes).

## 10. Declarative step behavior contract (D25, Tasks 08/10/11)

A step needs to tell the agent what it specifically expects — "implementation" and
"review" bound the same task differently — without the engine hardcoding either name.
Three new **optional, structured, author-provided** per-step schema fields:

```yaml
steps:
  review:
    purpose: "Confirm the implementation matches the task's acceptance criteria."
    expectedWork:
      summary: "No new code — read-only review producing PASS/CHANGES-REQUIRED feedback."
    hints:
      - { type: doc, ref: docs/development/testing-strategy.md }
      - { type: skill, ref: code-review }
    entryGates: []
    exitGates: [{ type: human, required: true, role: reviewer }]
    finalize: [{ id: commit-and-push }]
    transitions: [{ to: complete }]
```

- `purpose`: short string, the step's own stated intent.
- `expectedWork`: short structured description of what "done" means for *this step*
  (distinct from the task-level `allowed_paths` D22 already surfaces — a review step's
  "done" isn't "files changed within a path list").
- `hints`: array of `{ type: 'doc' | 'skill' | 'file', ref: string }` — structured
  references only, never inline prose essays.

All three are written once, by whoever authors the workflow definition YAML (Task 10 for
Standard) — the engine never generates them. Task 08 adds schema
support (accept and validate these fields — validation only, not consumption). Task 10
authors real content for Standard's steps. Task 11 wires the *configured* step contract
into `StepContext` (as e.g. `StepContext.stepContract`), presented alongside the
task-level `expectedWork`/hint fields D22 already added — a step with no `purpose`/
`expectedWork`/`hints` declared simply omits them from `StepContext`, never a fabricated
default.

## 11. Fail-closed workflow-definition version compatibility (D26, Task 08)

`resolveWorkflowMode(change)` already returns `change.workflow.version`; the loaded
definition already carries its own `version`. Nothing compares them today. **Fix:** the
same runtime-resolution path `step start`/`step finish` already use to load both values
asserts `change.workflow.version === definition.version` before doing anything else — a
mismatch throws an explicit `WorkflowDefinitionError` naming both versions. This is a
per-call guard, not migration infrastructure: no upgrade paths, no multi-version support,
nothing speculative. A long-lived task sitting at `workflow_progress.current_step` for
days must never silently keep resolving against a `standard.yaml` that was incompatibly
changed underneath it while it waited.

## 12. Transition cardinality and explicit entry step (D27, Tasks 08/10)

Two related precision gaps, both closed the same way D20 closed the unregistered-action
one — an explicit validation error instead of silently-different behavior:

- **Exactly one transition per step.** `transitions` is schema-shaped as an array, but
  every code path that reads it looks only at index 0. `validateWorkflowDefinition`
  rejects a step declaring zero or more than one `transitions` entries — for *every*
  step, since D19 already establishes that "terminal" is derived (whether the one
  transition's `to` matches another step name), not a separate schema shape. Conditional/
  multiple transitions remain explicitly out of scope until a real use case demands them.
- **Explicit, optional `entryStep`.** A new top-level definition field naming the step a
  fresh task (no `workflow_progress` yet) starts on. When present, it must name a real
  declared step; when absent, the first declared `steps` key is used exactly as today —
  so the current, unmodified `standard.yaml` (which has no `entryStep`) keeps behaving
  identically, satisfying Task 08's own non-regression requirement. Task 10's new
  multi-step Standard definition must set `entryStep` explicitly — a freshly-authored
  multi-step definition has no excuse to rely on implicit key ordering.
