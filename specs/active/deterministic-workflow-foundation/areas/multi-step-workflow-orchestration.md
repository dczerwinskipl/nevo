# Area: Multi-Step Workflow Orchestration

## Purpose

Close the gap between what Tasks 01-07 actually proved (one workflow step's full
lifecycle, including a multi-*stage* durable finalize sequence) and this
specification's actual target: a workflow *definition* with several distinct steps —
conceptually `implementation -> review -> quality -> human-approval -> complete`, or any
other configured sequence — driving an agent through all of them via repeated `workflow
step start` / `workflow step finish` cycles, with the workflow definition (never the
agent, never hardcoded engine logic) deciding what happens next at every step boundary.

This area covers Tasks 08-13 (renumbered — a new Task 10 was inserted 2026-09-11, D37;
what was Task 10/11/12 is now 11/12/13). See D18-D37 in `owner-decisions.md` for the
decisions behind it, and `overview.md` §14 for the summary of what's already good
(unchanged) vs. what's genuinely new.

**D18 is approved** (owner, 2026-09-08): `workflow_progress` is Git-tracked `change.yaml`
task state (Option 3), not runtime-local storage — it is long-lived workflow/domain
progress, unlike the finish-operation record's transient, single-call crash-recovery
state (D14).

This area doc has been revised three times since its first draft:

- **First revision** (§§8-12, D23-D27): finish-operation identity wasn't step-aware,
  human-verification sign-off wasn't step/gate-scoped, workflow definitions had no way
  to tell the agent what a *specific* step expects, nothing checked workflow-definition
  version compatibility, and the schema silently tolerated more than one transition per
  step while an entry step was only an implicit convention.
- **Second revision** (§§13-15 and refinements within §§3, 5, 9, 11, D28-D31): terminal
  vs. fresh-task resolution was still ambiguous, D24's storage-side scoping had no query
  path that could actually reach it, step/gate identifiers had no safety/uniqueness
  contract before being embedded in filesystem paths, a terminal transition target
  wasn't validated against any real vocabulary (a typo could reach `task.status`), the
  version check compared the wrong (raw vs. effective) field, and Task 11's step
  decomposition was wrongly left to implementer discretion instead of owner approval.
- **Third revision** (§16 and refinements within §§2, 3, D19/D28 correction, D32): the
  terminal-target vocabulary was too permissive (`TASK_STATUSES` instead of the
  narrower `TERMINAL_STATUSES` — `to: approved`/`to: in-implementation` would have
  wrongly validated), `store.mjs` was required-but-not-writable by Task 08 despite
  `finish-operation.mjs` needing an atomic two-field write it doesn't own, the
  legacy-mode `workflow_progress` rule was stated three different ways across this doc
  and Task 08, and Task 11's owner-approval prerequisite was implied to be provable by
  `node tools/docs.mjs validate` alone.
- **Fourth revision** (§17, new; corrections within §§1-3, 8, 13; D37): Task 08's
  already-verified implementation immediately advances `current_step` the instant
  `finish` succeeds, losing the semantic checkpoint between "step A's work is done" and
  "step B has actually begun" — no persisted state distinguishes them. The owner
  specified an explicit runtime `state: active | completed` axis, making `step start`
  (not `step finish`) the sole point that ever advances `current_step`. This also
  simplifies D28's terminal-resolution precedence (no longer needs to consult
  `task.status` at all) and D14/C18's crash-reconciliation intent (no longer compares
  `current_step` values, since `finish` no longer changes it). Task 08 itself is not
  reopened — a new, dedicated Task 10 corrects this in place, renumbering the former
  Tasks 10/11/12 to 11/12/13.

§§1-7 are the first draft's content (§§1-3 corrected in place by §17/D37 — see the
in-place notes there); §§8-16, plus the in-place refinements to §§3/5/9/11/13, are the
corrections; §17 is the fourth revision's own new section.

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

## 2. `workflow_progress` — persisted step position (D18, extended by D37)

New optional field on a task's `change.yaml` entry, meaningful only when the change's
`workflow.mode` is `deterministic`. **Extended by D37/§17** with a `state` field — shown
here in its corrected, current shape (the version without `state` was Task 08's original,
now-corrected shape):

```yaml
tasks:
  - id: my-task
    status: in-implementation      # unchanged legacy-compatible coarse lifecycle marker
    workflow_progress:
      current_step: review          # a key in the resolved workflow definition's `steps` map
      state: active                 # active | completed (D37) — which of the two runtime
                                     # states `current_step` is currently in
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
- Validation (`tools/specs/validation.mjs`), fail closed: `current_step`, when present,
  must name an actual step in the task's resolved workflow definition — a task record
  can never point at a step its own definition doesn't declare. **`workflow_progress` is
  valid only on a task whose change is `workflow.mode: deterministic`** — present on any
  other change, it is an explicit validation *error*, not a silently-ignored/meaningless
  field (this is the one authoritative rule; see D18's consequence and Task 08 §"Legacy
  coexistence").
- Written by the same `update-task` finalize stage (Task 06) that already writes
  `task.status`, in the same `change.yaml` read-modify-write — via a single, narrow,
  store-owned mutation helper (§16) that can set `status` and/or `workflow_progress`
  atomically in one `updateYamlFile` call, so both land in the same progress commit as
  the implementation (C14 unchanged, generalized). `finish-operation.mjs` calls this
  helper; it does not perform its own YAML read-modify-write.

## 3. Transition-target resolution: step name vs. terminal status (D19, internal case corrected by D37/§17)

A step's `transitions: [{ to: X }]` is resolved against the *current* workflow
definition's own `steps` map keys first:

- **`X` matches a declared step name** → this is an internal, workflow-scoped
  transition. **Corrected by D37:** `finish` does **not** write
  `workflow_progress.current_step = X` — it leaves `current_step` naming the step that
  just finished, sets `state: completed` on it, and appends a `history` entry recording
  `transitioned_to: X`. `current_step` only actually becomes `X` at the *next*
  `workflow step start` call (§17). `task.status` is untouched either way.
- **`X` matches no declared step name** → this is the terminal case, exactly as today's
  single-step `standard.yaml` (`to: verified`) already behaves: write `task.status = X`
  **and** `workflow_progress.state = completed` on the current step, atomically, in the
  same write (D37 restates this case unchanged from Task 08). `workflow_progress.current_step`
  is **not** cleared or nulled at this point — see §13 for exactly why, and for the
  precedence rule that makes leaving it populated safe.

This requires no new schema field on `transitions` itself and is fully backward
compatible — re-derive today's exact behavior as the degenerate one-step case. A
definition must not declare a step whose name collides with a terminal status value used
elsewhere as a `to` target in the *same* definition (validation error, not a silent
"advance to the step" resolution when a terminal write was intended) — Task 08 adds this
check. **`X` must additionally be a real member of the repository's canonical *terminal*
status vocabulary** — `TERMINAL_STATUSES` (`tools/specs/lifecycle-primitives.mjs`:
`implemented`/`verified`/`archived`/`abandoned`), **not** the broader `TASK_STATUSES`
(which also contains `draft`/`approved`/`in-implementation` — states a task passes
*through*, never a legitimate finalize-transition destination) — whenever `X` isn't a
step name. `to: approved`, `to: in-implementation`, and a typo like `to: verifed` are
all rejected identically, at load time, before any of them could reach `setTaskStatus`
(D19's refinement; see also §15 for the parallel identifier-safety rule for step/gate
names themselves).

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

## 5. Production-quality multi-step `standard.yaml` (Task 11, owner-approval gated — D31)

Today's `standard.yaml` is a single-step placeholder (`implementation -> verified`) that
exists to prove the *engine*, not to be Nevo's real Standard-change workflow. Task 11
replaces it with a genuine multi-step sequence — each step independently declaring its
own `entryGates`/`actions`/`exitGates`/`finalize`/`transitions`, plus a real `purpose`/
`expectedWork`/`hints` behavior contract (D25) and an explicit `entryStep` (D27).

**Exact step names, count, and gate composition are a product/process decision, not
implementer discretion (D31)** — Task 11 *proposes* a concrete decomposition, records it
as its own `owner-decisions.md` entry, and **stops for explicit owner approval** before
writing `.nevo-ai/workflows/standard.yaml` if that decomposition isn't already approved.
This area doc intentionally does not pre-select the shape either; the illustrative
sketch below is a non-binding example only, informed by Nevo's existing
review/verification practice (the legacy `approve`/self-check/human-verification
concepts D16's migration map already names):

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

Whoever starts Task 11 records the real step decomposition as its own decision entry
(`owner-decisions.md`) and gets it explicitly approved *before* implementing it — an
implementer may still freely decide low-level representation details inside an approved
decomposition (exact YAML formatting, which existing doc a `hints` entry references),
never the step sequence or gate ownership itself (D31).

## 6. `StepContext` knowledge/skill/file hints (D22, Task 12)

`overview.md` §7's original `StepContext` example (predating Task 06's implementation)
showed `instructions` and `expectedWork.allowedPaths`; the implemented
`compileStepContext()` never carries them. Task 12 adds them back, sourced
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

## 7. Real multi-step end-to-end proof (Task 13)

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

**Required regression test (Task 08, exercised again end-to-end in Task 13):** step A
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
file-backed and durable across process invocations.

**This scoping is only reachable end-to-end because the query contract itself is
extended (D29) — see §14.** Storage-side scoping alone (this section) would be
meaningless if the query reaching that storage never carried step/gate identity in the
first place; `HumanVerificationGate.inspect`/`.verify` (`gates/human-gate.mjs`, Task 05)
themselves change, which is why Task 08's `allowed_paths` includes that file.

## 10. Declarative step behavior contract (D25, Tasks 08/11/12)

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

All three are written once, by whoever authors the workflow definition YAML (Task 11 for
Standard) — the engine never generates them. Task 08 adds schema
support (accept and validate these fields — validation only, not consumption). Task 11
authors real content for Standard's steps. Task 12 wires the *configured* step contract
into `StepContext` (as e.g. `StepContext.stepContract`), presented alongside the
task-level `expectedWork`/hint fields D22 already added — a step with no `purpose`/
`expectedWork`/`hints` declared simply omits them from `StepContext`, never a fabricated
default.

## 11. Fail-closed workflow-definition version compatibility (D26, Task 08)

`resolveWorkflowMode(change)` (`compatibility.mjs`, Task 01) already computes the
*effective* workflow version — including the `workflow_mode: deterministic` shorthand
path, which has no `change.workflow.version` field at all and defaults to `1`. The
loaded definition carries its own `version`. Nothing compares them today. **Fix:** the
same runtime-resolution path `step start`/`step finish` already use to load both values
asserts `resolveWorkflowMode(change).version === definition.version` before doing
anything else — **not** the raw `change.workflow.version` field directly, which would
wrongly demand a field the shorthand manifest shape never has. A mismatch throws an
explicit `WorkflowDefinitionError` naming both versions. This is a per-call guard, not
migration infrastructure: no upgrade paths, no multi-version support, nothing
speculative. A long-lived task sitting at `workflow_progress.current_step` for days must
never silently keep resolving against a `standard.yaml` that was incompatibly changed
underneath it while it waited.

## 12. Transition cardinality and explicit entry step (D27, Tasks 08/11)

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
  identically, satisfying Task 08's own non-regression requirement. Task 11's new
  multi-step Standard definition must set `entryStep` explicitly — a freshly-authored
  multi-step definition has no excuse to rely on implicit key ordering.

## 13. Terminal/completed state precedence (D28, Task 08; corrected by D37/§17, Task 10)

**Corrected by D37 — resolution no longer consults `task.status` at all.** Task 08's
original rule (below, struck through in spirit, kept for history) checked `task.status`
first specifically because `workflow_progress.current_step` alone couldn't distinguish
"just finished, about to advance" from "fresh." The new `state: active | completed`
field (§17) removes that ambiguity structurally, so position resolution is now a pure
function of `(workflow_progress, definition)` alone — see §17 for the replacement
four-case rule. `task.status` remains written by `finish`'s terminal case exactly as
before (D13/C14), it is simply no longer *read* to determine workflow position.

**Task 08's original rule, for history:** resolution order, first match wins — this was
the exact rule that replaced the earlier, ambiguous "current_step, else entryStep"
description:

1. **`task.status` already equals one of the definition's valid terminal transition
   targets** (any step's one transition whose `to` resolves to a task-status per §3's
   refined validation) → the workflow is complete: resolved current step is `null`.
   This is checked *first*, before `workflow_progress` is even read.
2. **Else, `task.workflow_progress.current_step` exists** → use it.
3. **Else** → resolve `entryStep` (§12) — a task that has never touched this workflow.

`workflow_progress` is **never cleared or nulled** at terminal completion — `current_step`
keeps naming the last real step, and `history` gains one final entry recording the
terminal transition. This "never cleared" invariant is unchanged by D37 — only *how*
resolution uses `workflow_progress` changes (§17), not whether it's preserved. A task
whose workflow just finished must never look identical, from `step start`'s point of
view, to a task that never started it — under D37 this is guaranteed by `state:
completed` on a step whose transition is terminal (§17's case D), not by checking
`task.status` first.

**Required regression coverage:** step A finishes → step B finishes → step B's terminal
transition fires → the *next* `workflow step start` call reports the workflow complete,
never re-resolving `entryStep` as if the task were fresh. Unit-level in Task 08 and Task
10; end-to-end via CLI in Task 13.

## 14. The human-verification query contract carries full configured identity (D29, Task 08)

§9's storage-side step/gate scoping is only reachable if the *query* that reaches that
storage carries step/gate identity — it didn't, before this refinement.
`HumanVerificationGate.inspect(config, context)`/`.verify(config, context)`
(`gates/human-gate.mjs`, Task 05) build and pass a richer query to whatever reader is
injected:

```js
{
  changeId: context.changeId ?? context.change?.id ?? context.change?.slug ?? null,
  taskId: context.taskId ?? context.task?.id ?? null,
  stepId: typeof context.step === 'string' ? context.step : (context.step?.id ?? context.stepId ?? null),
  gateId: config.id ?? null,
  scope, targetId, requiredRole, // unchanged, Task 05's existing fields
}
```

Purely additive — `resolveHumanScopeTarget`'s existing `scope`/`targetId` computation is
unchanged, and a reader that only destructures `{ scope, targetId, requiredRole }` (the
existing `MemoryHumanVerificationReader`, Task 05's own tests) keeps working unmodified.
`FileHumanVerificationStore` (Task 07/08) is the first reader that actually uses
`stepId`/`gateId`/`changeId`. This is why Task 08's `allowed_paths` includes
`gates/human-gate.mjs` — a file Task 05 already implemented and verified, edited here for
an explicitly-scoped, additive reason, not a redesign of Task 05's own `inspect`/`verify`
separation or blocking-state contract. The security boundary (C8: caller JSON cannot
self-satisfy a gate; only the injected trusted reader is authoritative; only
`verify-human` writes confirmation) is unaffected — this only changes how much
identifying *fact* the query carries, never how much *authority* the caller has.

## 15. Safe, unique step and gate identifiers (D30, Task 08)

Every step-aware path in §8/§9 embeds user-authored identifiers directly into the
filesystem. Validated once, at workflow-definition schema time
(`definitions/schema.mjs`), fail-closed:

- Every `steps` map key, `entryStep` value, and any step-name-shaped `transitions[].to`
  value must match `^[a-zA-Z0-9_-]+$` — no slashes, backslashes, dots, or empty strings.
- Any gate's explicit `id` (any gate type) must match the same pattern when present.
- **A step with more than one `type: human` gate** (across its combined
  `entryGates`/`exitGates`) must give every one of them an explicit `id`, and those ids
  must be mutually distinct within that step — two human gates silently sharing (or both
  defaulting to) `human-review` is a load-time validation error, never a
  confirms-the-wrong-gate bug discovered later. A step with at most one human gate is
  unaffected — its `id` stays optional, defaulting exactly as `gateDisplayId`
  (`step-runner.mjs`, Task 06) already does.
- `workflow verify-human --gate <id>` (§9) refers to this exact, explicitly-configured
  `id`.

## 16. Atomic task-state write ownership (D32, Task 08)

`update-task` (Task 06) needs to write, in one `change.yaml` read-modify-write, whichever
of two things a given transition requires: a `workflow_progress` update (step advance)
and/or a `task.status` change (terminal case) — and per D28, sometimes conceptually
both matter for history even though only one is the "active" write for a given
transition. `tools/specs/store.mjs`'s existing `setTaskStatus(change, taskId, status)`
only ever sets one field per call; two separate calls would be two separate
`updateYamlFile` read-modify-writes — reintroducing exactly the "crash between two
writes leaves an inconsistent state" failure class D13 already eliminated for
implementation-vs-status commits.

**Fix:** add one new, narrow, `store.mjs`-owned helper —
`setTaskWorkflowState(change, taskId, { status, workflowProgress })` — that applies
whichever of `status`/`workflowProgress` is provided (either, or both) inside a single
`updateYamlFile` mutation, following the exact same structural-YAML-preserving pattern
`setTaskStatus` already uses (`doc.get('tasks', true)`, find the task item, `.set(...)`
per field). `finish-operation.mjs`'s `update-task` stage calls this helper — it does
**not** grow its own YAML mutation logic; `tools/specs/workflow/finish-operation.mjs`
has no direct dependency on the `yaml` library or `updateYamlFile` today, and this
decision keeps it that way. `setTaskStatus` itself is unchanged and keeps serving every
legacy caller that only ever needed the one field.

This is why Task 08's `allowed_paths` includes `tools/specs/store.mjs` (previously only
`context.required`, read-only) — Task 08 is the task that actually needs this atomic,
two-field write capability to exist.

## 17. Runtime `active`/`completed` step state — `step start` activates, `step finish` only completes (D37, Task 10)

Task 08's verified implementation collapses two distinct moments into one atomic write:
the instant `finish(A)` succeeds, `current_step` becomes `B` — there is no persisted
state corresponding to "A's work is verified and done, but B hasn't been entered yet."
The owner specified a minimal runtime-state axis to restore that checkpoint (D37) without
introducing a second, general-purpose state machine.

**Four concepts, kept strictly separate:**
1. **Step** — `current_step`, unchanged (D18).
2. **Runtime step state** — exactly `active` | `completed` (new field, `workflow_progress.state`).
3. **Semantic status** — each step declares `status: { active, completed }` in the
   workflow definition (new schema); this is a workflow-definition-scoped vocabulary,
   never added to `task.status`'s repository-wide lifecycle enum.
4. **Transition** — unchanged (`transitions: [{ to }]`, D27), read at `step start` time
   for the internal case (not written by `finish` for that case — see below).

**Semantic status is always derived, never a third persisted field:**
- no `workflow_progress` → `new`.
- `current_step: X`, `state: active` → `definition.steps[X].status.active`.
- `current_step: X`, `state: completed` → `definition.steps[X].status.completed`.

**Position resolution (replaces §13's Task 08 rule) — pure function of
`(workflow_progress, definition)`, `task.status` no longer consulted:**
1. No `workflow_progress` → **fresh** (case A below applies to `step start`).
2. `state: active` → resolved step is `current_step`, not yet finished (case B).
3. `state: completed` and the step's one transition names another declared step →
   resolved step is `current_step`, done, awaiting activation of the named target
   (case C).
4. `state: completed` and the step's one transition names no declared step (terminal,
   per §3/D19 refined) → workflow complete (case D).

**`workflow step start` becomes semantically real** (previously fully non-mutating,
Task 08/D10):
- **A. Fresh:** atomically persist `current_step: entryStep, state: active`; return that
  step's `StepContext`.
- **B. Active:** resume — return the same `StepContext`; no mutation at all.
- **C. Completed, transition names a step:** atomically persist `current_step: <target>,
  state: active`; return the new step's `StepContext`. No `history` entry — `history`
  only records completions, never activations.
- **D. Terminal:** report the workflow complete; start nothing.
- One atomic `workflow_progress` write, nothing more — no new durable multi-stage
  operation record (D14's machinery is not reused): a crash before the write means the
  next call re-resolves the same case and writes the same value; a crash after means the
  next call resolves case B and returns the current `StepContext`. Idempotent by
  construction.

**`workflow step finish`, internal-transition case (terminal case unchanged from Task
08):**
1. evaluate/verify exit gates (unchanged),
2. run finalize actions through the existing durable finish operation (unchanged
   mechanism — D23's step-aware record identity is unaffected, since `finish` no longer
   changes which step it belongs to),
3. atomically, via `setTaskWorkflowState` (D32): `current_step` **unchanged**;
   `state: completed`; append one `history` entry `{ step, completed_at,
   transitioned_to: <target> }`. `task.status` untouched.

The terminal case is otherwise identical to Task 08: `state: completed` +
`task.status = <terminal value>` + the `history` entry, all in the one write;
`current_step` keeps naming the final completed step (§13's "never cleared" invariant,
unaffected).

**Repeated `finish` on an already-`completed` step** (no intervening `step start`) is a
non-actionable no-op: resolve position, see `state: completed`, return an explicit
`already-completed`-shaped result without touching the finalize/finish-operation
machinery at all.

**Crash reconciliation (corrects D14/C18's `update-task` intent for the internal case):**
the persisted intent becomes a uniform `{ fromState: 'active', toState: 'completed' }`
comparison against `workflow_progress.state` at the operation's own step (plus, for the
terminal case only, the existing `{ toStatus }` component for the `task.status` write) —
replacing Task 08's `{kind:'step', fromStep, toStep}` comparison, which compared
`current_step` values that no longer change during `finish`. `current_step ==
transitionTarget` is never used as a postcondition anywhere after this correction.

**`StepContext` gains two fields**, computed by the same pure helper that computes
position/semantic-status above: `runtimeState: 'active' | 'completed'` and
`semanticStatus: <resolved identifier>`. No sequencing logic is duplicated — `StepContext`
only surfaces what the shared resolution helper already computed (unchanged principle,
D10/D22).

**Schema:** every step in a production deterministic workflow definition must declare
`status: { active, completed }` — both required, validated against the existing
`SAFE_IDENTIFIER_PATTERN` (D30), non-empty; not display labels or i18n copy. **Migration
(fail-closed, no silent default):** the four already-shipped one-step definitions and
their templates (`standard`, `architectural`, `small`, `exploratory`) gain
`status: { active: implementing, completed: implemented }` on their one `implementation`
step, in the same task that introduces this requirement — the same D33-D36 precedent of
an engine-tightening task also fixing the production-yaml fallout its own stricter schema
causes. A definition missing `status` fails to load from the moment this ships; there is
no code path that synthesizes a placeholder.

See D37 in `owner-decisions.md` for the full decision record, including exactly which
prior decisions (D18, D19, D28, D14/C18) this corrects and why D23 and D9/D10 are
unaffected.
