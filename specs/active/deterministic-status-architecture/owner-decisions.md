# Owner decisions — deterministic-status-architecture

## D1: Scope and architecture are owner-directed, superseding the earlier draft framing

- **Question:** How should this change be scoped and architected?
- **Options considered:** Not an agent-proposed option set — the owner supplied a complete,
  prescriptive architecture directly (legacy/deterministic lifecycle separation, hard
  command guards, deterministic task publish, canonical projection, readiness policy,
  UI split, human-interaction projection, skill split), which this spec records rather
  than derives via `references/solution-option-analysis.md`.
- **Decision:** Implement exactly the architecture the owner specified. This supersedes
  the narrower framing recorded in this change's pre-existing draft `overview.md` (single
  yaml-derived status axis merging `task.status`/`workflow_progress`, a new `refine` step,
  UI board configuration as project config) — the owner's brief explicitly keeps
  `task.status` in place as transitional compatibility storage rather than merging the two
  axes, and does not ask for a `refine` step or board-configuration mechanism in this
  change.
- **Rationale:** Dogfooding deterministic execution now requires a usable end-to-end path
  without first building full deterministic spec/task authoring — a smaller, transitional
  fix is preferred over a full redesign.
- **Consequences:** `overview.md`'s "Candidate scope" framing from the earlier draft no
  longer applies to this change. The two-axis-merge idea and the `refine` step remain
  live *questions* for a future change, not scope here.
- **Date:** 2026-09-17
- **Affected artifacts:** `overview.md`, all `areas/*.md`, all `tasks/*.md`.

## D2: CLI default-task resolution for deterministic commands

- **Question:** When `workflow step start`/`workflow step finish`/the human-decision
  operation omit the task id, what should replace today's fallback to legacy
  `status === 'in-implementation'` (`resolveDefaultTask` in `tools/specs/workflow/cli.mjs`)?
- **Options considered:** (a) require an explicit task id always; (b) model a new
  deterministic "active/in-flight" concept derived purely from `workflow_progress` across
  the change's tasks.
- **Decision:** (a) — require an explicit task id for deterministic commands. Drop the
  legacy-status fallback without replacing it with new state.
- **Rationale:** Matches the change's own "out of scope: new permanent task authoring
  state model unless necessary" — option (b) is a real future improvement but not
  necessary to remove the legacy-status reliance the brief targets.
- **Consequences:** Deterministic commands without a task id now error clearly instead of
  guessing. Revisit if this proves too inconvenient in practice.
- **Date:** 2026-09-17
- **Affected artifacts:** `tasks/06-deterministic-cli-default-task-resolution.md`.

## D3: Ownership-boundary documentation location

- **Question:** Where should the legacy/deterministic lifecycle-mutation ownership
  boundary be documented, given `docs/development/package-boundaries.md` covers only the
  .NET project-reference graph and has no bearing on `tools/specs/**`?
- **Options considered:** (a) extend `docs/development/agent-workflow-protocol.md`'s
  existing "Ownership Boundaries & Manifest Immutability" section; (b) create a new
  focused document (e.g. `docs/development/lifecycle-boundaries.md`).
- **Decision:** (a) — extend the existing section.
- **Rationale:** `references/artifact-policy.md` disfavors new docs when an existing one
  already owns adjacent content; the existing section is already about agent-facing
  lifecycle-mutation ownership, which is exactly this boundary's subject.
- **Consequences:** No new top-level doc file is created by this change.
- **Date:** 2026-09-17
- **Affected artifacts:** `tasks/22-ownership-boundary-documentation.md`.

## D4: This change's own `workflow.mode` stays `legacy`

- **Question:** Should this change itself run under `workflow.mode: deterministic` (to
  dogfood the very system it's fixing) or `legacy`?
- **Decision:** `legacy` (carried over from the pre-existing draft, unchanged by D1).
- **Rationale:** Redesigning what deterministic mode means should not require deterministic
  mode to already be correct in order to implement the redesign. `ai-spec-history` remains
  the separate, unchanged deterministic dogfood spec named in
  `docs/development/agent-workflow-protocol.md` §4.
- **Consequences:** This change's own tasks execute via `node tools/specs.mjs
  next`/`context`/`start`/`complete`/`verify`, not `workflow step start`/`finish`.
- **Date:** 2026-09-17 (originally recorded in the pre-existing draft; reaffirmed here)
- **Affected artifacts:** `change.yaml`.

## D5: Step-executor model replaces the `HumanVerificationGate`-based interaction model

- **Question:** How should human-owned work inside a deterministic workflow be modeled —
  as a special `human-verification` step name / decision gate (the design this change
  originally recorded), or as a generic `executor: agent | human` property on every step?
- **Options considered:** (a) keep the original design (a literal step-name check plus a
  `verification`/`decision`-shaped human-interaction projection built from
  `HumanVerificationGate`); (b) a generic per-step `executor` property with its own
  execution protocol, enforced as an invariant, with `entryGates`/`exitGates` (`type:
  human`) kept as a distinct, separate mechanism (a gate blocks another executor's step;
  an `executor: human` step is *executed* by a human, who chooses its outcome).
- **Decision:** (b). The deterministic flow this change targets was never exercised through
  a full end-to-end test before this correction; the owner directed dropping compatibility
  with whatever the first attempt had already built and correcting the architecture before
  any implementation starts, while continuing to fully support the legacy flow unchanged in
  the meantime.
- **Rationale:** A literal step-name check is exactly the kind of hardcoded coupling this
  whole change exists to remove elsewhere (`stageForStatus`, `isTaskReady`) — reintroducing
  it for human review specifically would be inconsistent. A generic `executor` property is
  also the natural place to enforce "an agent must never execute a human-owned step and
  vice versa" as an invariant, not just a UI convention.
- **Consequences:** `entryGates`/`exitGates` remain unchanged as a separate mechanism. This
  is a pre-implementation correction — no implementation code built on the old design is
  being migrated.
- **Date:** 2026-09-18
- **Affected artifacts:** `areas/step-executor-model.md`,
  `areas/deterministic-projection-and-human-step.md`.

## D6: Workflow-definition schema gets one bounded, individually-audited migration

- **Question:** How does `executor`, transition `action` metadata (label/feedback), and a
  terminal-transition success/failure `outcome` reach existing workflow definitions
  (`.nevo-ai/workflows/*.yaml`) — an implicit default, or an explicit migration? And does
  every definition actually have a human-owned step?
- **Decision:** Explicit, individually-audited migration of the five existing definition
  files (`tasks/07-workflow-definition-schema-extensions.md`). Grounded per-file audit
  (2026-09-19) found the assumption "all five definitions have a human-owned step" false:
  - `standard.yaml`/`standard-v1.yaml` (identical content): `implementation` → `review` →
    `human-verification` — a genuine standalone step with its own transitions and no gates
    of its own. Only **this** step becomes `executor: human`; `implementation`/`review`
    stay `executor: agent` (defaulted, unchanged).
  - `architectural.yaml`: one step, `implementation`, with an agent `exitGates: [{type:
    command}, {type: human, required: true}]` — a human **confirmation gate** on an
    agent-executed step, not a human-owned step. Stays `executor: agent`; the gate is
    untouched.
  - `exploratory.yaml`: one step, `discovery`, same pattern — `exitGates: [{type:
    markdown}, {type: human, required: true}]`. Stays `executor: agent`; the gate is
    untouched.
  - `small.yaml`: one step, `implementation`, no human gate at all. Stays `executor: agent`
    (default; the field need not even be written).
  - A default of `executor: agent` when the field is entirely absent covers every
    agent-only step, so the migration only touches `standard`/`standard-v1`'s
    `human-verification` step for the `executor` field.
- **Rationale:** An inferred default for the *human* case specifically would silently
  assume "agent" unless a step happens to be named a certain way — reintroducing exactly
  the name-based coupling D5 removes, and mechanically converting every `type: human` gate
  into a human-owned step would incorrectly merge the two distinct mechanisms D5 keeps
  separate.
- **Consequences:** Only `standard.yaml`/`standard-v1.yaml` gain `executor: human` (on
  `human-verification`) plus `action` metadata on that step's transitions.
  `architectural.yaml`/`exploratory.yaml`/`small.yaml` are unaffected by the `executor`
  field entirely. See D9 for the separate, per-transition `outcome` migration, which
  applies to all five files' terminal transitions.
- **Date:** 2026-09-19 (supersedes the 2026-09-18 version of this decision, which assumed
  every definition needed a human-owned step)
- **Affected artifacts:** `areas/step-executor-model.md`,
  `tasks/07-workflow-definition-schema-extensions.md`.

## D7: Human-step surface consolidation — shared component, not a chat→dialog redirect

- **Question:** Chat already renders its own Approve/Request-changes UI
  (`AgentSessionChatSurface`/`AgentSessionWorkflowBar`). Should the new reusable
  human-step surface replace that in place (both call sites render the same component), or
  should chat instead navigate/open `TaskDialog` to show it?
- **Decision:** Shared component (`HumanStepSurface`, D11), rendered directly by both
  `TaskDialog` and the existing chat surface — not a navigation redirect.
- **Rationale:** Chat's in-place review affordance is existing, working UX; forcing a
  navigation away from chat to act on a human step would be a regression, not a
  consolidation. A shared component achieves "one implementation" without that UX cost.
- **Consequences:** `human-step-surface-consolidation` (task 20) touches both
  `task-dialog.tsx` and the chat surface files, replacing chat's existing separate
  implementation with the shared component rather than leaving it as a second one.
- **Date:** 2026-09-18
- **Affected artifacts:** `areas/human-step-surface.md`,
  `tasks/20-human-step-surface-consolidation.md`.

## D8: Import boundary — extract `TERMINAL_STATUSES`, not a blanket ban with no removal path

- **Question:** `tools/specs/lifecycle-primitives.mjs` contains both genuinely
  legacy-specific concepts (`isTaskReady`, `DEPENDENCY_SATISFYING_STATUSES`, `TRANSITIONS`,
  `depsSatisfied`) and one piece of vocabulary the deterministic engine also genuinely
  needs (`TERMINAL_STATUSES`, used to validate/discriminate a transition's terminal `to`
  target). A prior version of this decision banned deterministic code from importing the
  file at all, but named no task to remove the two imports that already exist — the ban
  would fail the moment its own regression test ran.
- **Grounded fact (2026-09-19):** exactly two files under `tools/specs/workflow/**` import
  `lifecycle-primitives.mjs` today, both for `TERMINAL_STATUSES` only:
  `tools/specs/workflow/finish-operation.mjs` (terminal-vs-internal transition
  discrimination) and `tools/specs/workflow/definitions/schema.mjs` (transition-target
  validation). Grep confirmed no other file in `tools/specs/workflow/**` imports it.
- **Decision:** Extract `TERMINAL_STATUSES` into a new, neutral module (e.g.
  `tools/specs/status-vocabulary.mjs`). `lifecycle-primitives.mjs` re-exports it so every
  existing legacy import path is unaffected. `finish-operation.mjs` and
  `definitions/schema.mjs` import it from the neutral module instead
  (`tasks/03-status-vocabulary-extraction.md`, which must land — and actually remove both
  existing imports — before `lifecycle-boundary-regression-tests` (task 04) enables the
  static check). `isTaskReady`, `DEPENDENCY_SATISFYING_STATUSES`, `TRANSITIONS`,
  `depsSatisfied`, and the full `TASK_STATUSES`/`CHANGE_STATUSES` enum stay in
  `lifecycle-primitives.mjs`, legacy-only, never extracted.
- **Rationale:** `TERMINAL_STATUSES` is genuinely shared persistence vocabulary (both
  lifecycles write to the same terminal-status set on `task.status`); the other four
  concepts are legacy interpretation of that vocabulary, not the vocabulary itself —
  extracting only the former keeps the boundary honest without inventing a shared
  "lifecycle" abstraction the change's own architecture forbids.
- **Consequences:** The import-boundary regression test (task 04) checks: no file under
  `tools/specs/workflow/**` imports `tools/specs/lifecycle-primitives.mjs` (post-extraction,
  zero such imports exist to begin with); `tools/specs/status-vocabulary.mjs` is exempt
  (shared, semantics-free); `lifecycle-primitives.mjs`'s own re-export of it is legacy
  code's business, not deterministic code's.
- **Date:** 2026-09-19 (supersedes the 2026-09-18 version of this decision, which named no
  task to actually remove the two pre-existing imports)
- **Affected artifacts:** `areas/lifecycle-boundary-guards.md`,
  `tasks/03-status-vocabulary-extraction.md`,
  `tasks/04-lifecycle-boundary-regression-tests.md`.

## D9: Deterministic "successful terminal" is an explicit per-transition field, on the transition that actually targets a terminal status

- **Question:** How does dependency satisfaction distinguish a workflow's successful
  terminal outcome from any other terminal outcome, without reusing legacy status semantics
  or hardcoding a step name — and where does that field actually belong, given the engine's
  real model?
- **Grounded fact (2026-09-19):** there is no "terminal step with no transitions" concept in
  this engine. Every step declares `transitions`; a transition's `to` is validated
  (`definitions/schema.mjs`) to be either another declared step name (an internal
  transition) or a member of `TERMINAL_STATUSES` (`implemented`/`verified`/`archived`/
  `abandoned`) — never both, never neither. `finish-operation.mjs`'s `discriminateTarget`
  makes exactly this distinction at runtime. A prior version of this decision proposed
  `outcome` on "a step with no outgoing transitions," which does not exist in this
  definition model and would have been unimplementable as written.
- **Decision:** `outcome: success | failure` lives on the **transition** whose `to` targets
  a terminal status, e.g. `{ value: pass, to: verified, outcome: success }` — never on a
  step, and never inferred from the terminal status name. Internal (step-to-step)
  transitions never carry or need `outcome`. Per the D6 audit, every terminal transition in
  all five current definitions targets `verified` (none currently model a failure-terminal
  transition) — so today's migration writes `outcome: success` only; `outcome: failure`
  is defined and validated as a legal value for a future definition that adds one, not
  retrofitted onto anything that doesn't exist today.
- **Rationale:** Ground the schema addition in the engine's actual `to`-discrimination
  model instead of an imagined one; still forbid inferring "success" from the target
  status's name (`verified`), per the original intent of this decision.
- **Consequences:** `deterministic-dependency-satisfaction` (task 11) resolves a task's
  matched terminal transition from its `workflow_progress.history`'s last entry (`step` +
  `transitioned_to`, resolved against that step's declared `transitions` in the
  definition) and reads *that transition's* `outcome` — never the step's name, never legacy
  `TERMINAL_STATUSES`/`DEPENDENCY_SATISFYING_STATUSES`. This is deliberately the smallest
  addition that makes the concept explicit — not a full terminal/outcome model redesign.
- **Date:** 2026-09-19 (supersedes the 2026-09-18 version of this decision)
- **Affected artifacts:** `areas/step-executor-model.md` (schema),
  `areas/deterministic-projection-and-human-step.md` (consumer),
  `tasks/07-workflow-definition-schema-extensions.md`,
  `tasks/11-deterministic-dependency-satisfaction.md`.

## D10: Three-layer separation — pure projection, readiness, dashboard action DTO

- **Question:** Should the canonical deterministic task projection also own
  runtime-dependent "available application actions," or should that be a separate layer?
- **Decision:** Three explicit layers, each with one owner: **`TaskProjection`** (pure
  workflow/domain state only — `state`, `currentStep`, `nextStep`, `executor`, `attempt`,
  `blockedBy`, terminal outcome, plus a generic current/next-step descriptor and, only
  while a human step is actually active, its interaction-actions descriptor — both derived
  straight from the definition, no readiness/git/session dependency) → **`ExecutionReadiness`**
  (task 13 — composes `TaskProjection` with the executor guard and the *existing*
  activation-precondition checks already implemented by `ensureStepActivated`, reused not
  duplicated per D13) → **`DashboardActionProjection`** (task 14 — composes both into the
  actual `availableActions` the UI renders — one generic `"start-step"` when the current
  position is waiting and readiness allows it, never a per-step or per-executor action id;
  see D15 for why even `start-agent-step`/`start-human-step` were too specific).
- **Rationale:** Avoids a circular responsibility where the "pure" projection has to know
  about git worktree state or session binding to answer "can the current step start" —
  that question genuinely depends on more than workflow-definition state, and conflating
  the two made `TaskProjection` neither pure nor complete.
- **Consequences:** `deterministic-task-projection` (task 12) never returns
  `availableActions`. Every consumer that previously would have read "available actions"
  from the projection now reads it from the dashboard action DTO (task 14), which itself
  depends on both task 12 and task 13 — corrected throughout the task graph (task 14's,
  18's, and 19's `depends_on`).
- **Date:** 2026-09-19
- **Affected artifacts:** `areas/deterministic-projection-and-human-step.md`,
  `areas/execution-readiness-and-session-bootstrap.md`,
  `areas/dashboard-server-actions-wiring.md`, `change.yaml` (task dependency graph).

## D11: Generic naming for reusable domain/UI components

- **Question:** Should the reusable human-step interaction component and operations be
  named around "review" (`human-review-surface`, `approve`/`request-changes`), or generically?
- **Decision:** Generic names for reusable core/domain APIs and components:
  `HumanStepSurface` (UI component, was `human-review-surface`), `startHumanStep` /
  `submitHumanStepResult` (domain operations, task 09). Product-facing labels ("Review,"
  "Approve," "Request changes") remain workflow-definition metadata (`action.label`,
  D5/D6) — never hardcoded into the generic component/operation names themselves.
- **Rationale:** The architecture is no longer specifically about "review" — a future
  workflow definition could have a human step that isn't a review at all (e.g. a manual
  data-entry step), and the domain layer should not assume otherwise.
- **Consequences:** Renamed throughout: `areas/human-review-surface.md` →
  `areas/human-step-surface.md`; `human-review-surface-consolidation` →
  `human-step-surface-consolidation` (task 20).
- **Date:** 2026-09-19
- **Affected artifacts:** `areas/human-step-surface.md`,
  `tasks/20-human-step-surface-consolidation.md`, `tasks/09-human-step-execution-operations.md`.

## D12: Human-step execution reuses `ensureStepActivated`/`finishStep` — not a bespoke implementation

- **Question:** Should `startHumanStep`/`submitHumanStepResult` (the new legal activation
  and generic-result-submission path for a human-owned step) be built as new, independent
  bookkeeping, or as thin wrappers over the engine's existing, already-generic activation
  and finish machinery?
- **Grounded fact (2026-09-19):** the real engine already has almost everything needed.
  `ensureStepActivated` (`step-context.mjs`) is the one shared activation function
  `workflow step start` already calls — it is not agent-specific in its own logic (it
  writes `workflow_progress`/checks the clean-worktree precondition identically regardless
  of who calls it). `finishStep`/`planFinish` (`finish-operation.mjs`) already accept a
  generic `{ result, feedback, artifacts }` input, match `result` against the active step's
  declared `transitions[].value`, and run the same fixed finalize stage sequence — this is
  already the "generic humanAction({result, feedback})" shape item 3 of the corrective pass
  asked for; it does not need to be reinvented. The *only* actually hardcoded parts, both in
  `handleWorkflowVerifyHuman`, are: the literal `targetStep !== 'human-verification'` check,
  and the CLI-level mapping of `--approve`/`--request-changes` flags to
  `result: 'pass'/'fail'`.
- **Decision:** `startHumanStep` calls `ensureStepActivated` directly (same function, same
  behavior, same clean-worktree/finish-operation-settled guards — D13), gated by an
  executor check (reject `executor: agent`), and does not call `autoBindAgentSession`
  (unlike `handleWorkflowStepStart`, which does). `submitHumanStepResult` calls `finishStep`
  directly with a caller-supplied `{ result, feedback, artifacts }`, gated by the same
  executor check. The literal `'human-verification'` step-name check is replaced by the
  executor check; the CLI's `--approve`/`--request-changes` flags may stay as *CLI-level*
  compatibility sugar translating to `result: 'pass'/'fail'`, but the domain operation
  itself never hardcodes "approve"/"pass" as its own concept.
- **Rationale:** Building a second, parallel activation/finish implementation for human
  steps would duplicate exactly the durable, crash-safe, resumable machinery
  `finishStep`/`ensureStepActivated` already provide — a correctness risk, not an
  architectural improvement.
- **Consequences:** `human-step-execution-operations` (task 09) is a thin wrapper module,
  not a new engine. `--confirm` (the separate `entryGates`/`exitGates` human-gate
  confirmation path via `FileHumanVerificationStore`) is untouched.
- **Date:** 2026-09-19
- **Affected artifacts:** `areas/step-executor-model.md`,
  `tasks/09-human-step-execution-operations.md`.

## D13: `ensureStepActivated`'s existing resume-vs-new-attempt distinction is preserved, not reimplemented

- **Question:** Does the engine currently conflate "resuming an active attempt" with
  "starting a genuinely new attempt" for the clean-worktree precondition, requiring a fix?
- **Grounded fact (2026-09-19):** no. `ensureStepActivated` (`step-context.mjs`) already
  returns immediately, with no dirty-worktree check at all, when `position.phase` is
  `active` (resume) or `terminal`. The dirty-worktree check (`git.getDirtyPaths`, excluding
  `.nevo-ai-local/`) runs only for `phase === 'new'` or `phase === 'completed'` — i.e. only
  when actually activating a step (a fresh attempt or the next step). This already
  implements exactly "new attempt + dirty baseline → fail" and "resume active attempt +
  dirty worktree → allowed." A prior version of this spec incorrectly asserted current
  behavior does not distinguish these and proposed to "fix" it.
- **Decision:** Correct the spec text; do not modify `ensureStepActivated`'s existing
  behavior. `execution-readiness-policy` (task 13) inspects/reuses this existing
  distinction (extracting its dirty-worktree check into its own exported, reusable
  function from `step-context.mjs` if needed for a read-only preflight query) rather than
  reimplementing a second git-dirty-check. `workflow step start`, `startHumanStep`
  (task 09), and any preflight readiness query all resolve to the same one
  `ensureStepActivated` code path for the actual activation decision.
- **Rationale:** A second implementation of the same precondition is a correctness risk
  (the two could drift) and directly contradicts this change's own "no duplicate
  readiness/activation guards" requirement.
- **Consequences:** Task 13's scope is corrected from "build a new readiness check
  distinguishing resume from new" to "compose the existing, unmodified distinction,
  extracting a read-only query function from `step-context.mjs` only if a preflight
  (non-mutating) check is genuinely needed alongside it."
- **Date:** 2026-09-19 (supersedes the 2026-09-18 version of task 13/11's design, which
  proposed reimplementing this distinction)
- **Affected artifacts:** `areas/execution-readiness-and-session-bootstrap.md`,
  `tasks/13-execution-readiness-policy.md`.

## D14: Dashboard human-step transport contract

- **Question:** `startHumanStep`/`submitHumanStepResult` (D12) existed only as domain
  operations with no HTTP transport a browser could call — the only existing dashboard
  route, `POST .../workflow/human-decision`, hardcodes `decision: 'approve'|'request-changes'`
  and calls `handleWorkflowVerifyHuman` (the CLI compatibility layer), not the generic
  operations directly. What transport should `HumanStepSurface` actually call?
- **Grounded fact (2026-09-19):** `tools/dashboard/server/specs/routes.mjs` (`handleHumanDecision`)
  and `tools/dashboard/server/specs/actions.mjs` (`executeHumanDecision`) confirm this
  exactly — the request body is literally `{ decision, feedback }`, validated against the
  two hardcoded strings, then translated to `{ approve: true|false, requestChanges: ...,
  feedback }` and passed to `handleWorkflowVerifyHuman`. No route exists for explicitly
  activating a waiting human step, or for submitting an arbitrary definition-driven
  `result`.
- **Decision:** One new, generic route, `POST /api/specs/:slug/tasks/:taskId/workflow/human-step`
  (plus the existing `:source/:slug` variant this codebase's other routes use), with body
  `{ action: 'start' } | { action: 'submit', result?, feedback?, artifacts? }` — `'start'`
  maps directly to `startHumanStep`, `'submit'` maps directly to `submitHumanStepResult`,
  passing `result`/`feedback`/`artifacts` through unchanged (no `result` required for an
  unconditional human step — D16 below). Route validation is generic and definition-driven
  (accepts any `result` string, delegates the actual legality check to
  `submitHumanStepResult`/`finishStep`) — it never maps a result back to `'approve'`/
  `'request-changes'`. Errors from the domain layer (executor mismatch, readiness failure,
  invalid transition result) are returned as structured JSON (`code`, and whichever of
  `stepId`/`executor`/`allowedResults` apply) with an appropriate HTTP status, not
  flattened into a single opaque message. The existing `/workflow/human-decision` route
  and `executeHumanDecision` stay exactly as they are, for the CLI-compatibility case
  (`handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` flags) and any other
  existing caller — `HumanStepSurface` itself (D7/D11) uses only the new route, never the
  old one.
- **Rationale:** A single generic command endpoint matches D11's "generic naming" intent
  and D5's "engine never understands 'Approve'/'Request changes'" principle — introducing
  more review-shaped endpoints would reintroduce exactly the coupling this whole change
  removes elsewhere. Keeping the old route for legacy callers avoids an unnecessary,
  simultaneous breaking change to `handleWorkflowVerifyHuman`'s own dashboard caller.
- **Consequences:** A new task, `dashboard-human-step-transport` (order 16), owns the new
  route, its server-side handler (a new module, not added to the mutation-split scope of
  `dashboard-actions-lifecycle-split`, to avoid file-overlap between two independently
  developed concerns), and the one neutral client-side function that calls it (see D17 for
  why this is a `shared/lib` function, not a feature-owned hook).
  `human-step-surface-consolidation` (task 20) now depends on it.
- **Date:** 2026-09-19
- **Affected artifacts:** `change.yaml` (new task 16, renumbered 16–21 → 17–22),
  `areas/dashboard-server-actions-wiring.md`, `areas/human-step-surface.md`,
  `tasks/16-dashboard-human-step-transport.md`, `tasks/20-human-step-surface-consolidation.md`.

## D15: One generic `start-step` action; no step-id dispatch anywhere — the workflow step, not "implementation"/"review", has always been the abstraction (supersedes the 2026-09-19 "transitional adapter" version of this decision)

- **Question (original, now rejected):** `executor: agent` alone doesn't tell the
  application *how* to dispatch a given agent step — today's UI genuinely behaves
  differently for `implementation` (edit mode) vs. `review` (agent mode). The original
  version of this decision answered that by keeping a small, "explicitly transitional"
  `implementation`/`review` → dispatch-mode lookup at the UI boundary
  (`session-bootstrap-readiness-wiring`). A fresh review found that answer itself wrong:
  isolating a step-id lookup at one boundary is still a step-id lookup — it still breaks
  the moment a definition adds a third agent step (`discovery`, `hardening`, anything), and
  every one of this change's own areas/tasks that referenced it (`start-agent-step`,
  `start-human-step`, "review-appropriate lane," "Ready for review") had already started
  treating that lookup as load-bearing rather than a narrow, disposable stopgap. The
  question was wrong at the root: the application does not need to know *how* to dispatch a
  step at all — only that a step exists, who executes it, and (for an agent step) that a
  session should run `workflow step start` and let the returned `StepContext` supply the
  actual instructions.
- **Grounded fact (2026-09-19, second read):** `compileStepContext()`
  (`tools/specs/workflow/step-context.mjs`) already returns, for the authoritative current
  step, everything an agent needs to act: `currentStep`, `attempt`, `instructions`,
  `stepContract.purpose`/`.expectedWork`/`.hints`, `expectedWork.allowedPaths`/
  `.forbiddenPaths`, `relevantDocs`, `previousTransition`, `entryState`, `finishContract`.
  `AgentSessionService`'s existing `resolveDeterministicWorkflowInfo()` +
  `formatNevoWorkflowContext()` (`tools/dashboard/server/ai/sessions/service.mjs`) already
  inject a hidden `[Nevo Workflow Context]` header into a session's first turn instructing
  the agent to run `node tools/specs.mjs workflow step start <change> <task>` before
  touching any file — this mechanism is real, already fail-closed for the *task/step
  resolution* itself (`resolveDeterministicWorkflowInfo` throws
  `AiDeterministicWorkflowUnavailableError` rather than guessing), and needs no redesign.
  There is no second, dashboard-owned instruction system to invent — one already exists and
  is authoritative.
- **Decision:**
  1. **One generic lifecycle action.** `DashboardActionProjection` exposes
     `availableActions: ["start-step"]` (a plain string, D14's `availableActions?: string[]`
     shape, not a new object-union type) for a task in `waiting-for-step-start` when
     `ExecutionReadiness` allows it — never `start-agent-step`, `start-human-step`,
     `start-implementation`, or `start-review` as distinct action identifiers. `executor`
     (already carried on the step descriptor) tells the *caller* which execution protocol
     `start-step` triggers — it is never encoded into the action id itself.
  2. **No step-id dispatch, anywhere, full stop.** No `switch`/`if`/lookup-object keyed on
     `step.id` (or `currentStep`/`nextStep` as a string) may exist in `TaskProjection`,
     `ExecutionReadiness`, `DashboardActionProjection`, the session-bootstrap client code,
     or the board/lane projection. A newly authored agent-owned step (`discovery`,
     `hardening`, anything) must work with zero application code changes — this is the
     concrete, testable bar (item 15's generic fixture requirement).
  3. **Session bootstrap sends a generic trigger, never a semantic prompt.** Clicking
     `start-step` for an `executor: agent` step creates/reuses the task's authoritative
     execution session and sends one generic, visible message — conceptually "Execute the
     current workflow step for task `<task>`" — never "Implement task…"/"Review task…"/any
     step-id-derived semantic prompt. The *actual* work contract still comes from the
     existing `[Nevo Workflow Context]` injection → `workflow step start` → `StepContext`,
     unchanged (this decision does not touch that mechanism beyond removing its two
     `'implementation'` defaults — see the affected-artifacts task for the exact fix). The
     application layer knows "this is deterministic task execution"; it must not know "this
     is implementation" / "this is review" / "this is discovery" as semantic categories.
  4. **Human-owned steps are unaffected in kind, only in naming.** `start-step` +
     `executor: human` still routes through `startHumanStep` (no AI session, D12,
     unchanged); an active human step's selectable results still come entirely from
     `transitions[].action` (D5/D6, unchanged) via the human-interaction descriptor —
     `availableActions` never duplicates or replaces that descriptor's own `result`/`label`
     values.
  5. **Board/lane projection is corrected to match.** A deterministic task's lane derives
     only from `TaskProjection.state` (`draft`/`blocked`/`ready`/`waiting-for-step-start`/
     `active`/`human-interaction`/`terminal`) and, if genuinely needed for presentation,
     `executor` — never `currentStep`. If the legacy six lane ids are reused as
     compatibility/presentation buckets for deterministic tasks, that reuse is explicitly
     documented as a presentation convenience, not workflow-step semantics — an `active`
     `review` task and an `active` `hardening` task land in the same bucket. There is no
     dedicated "review lane."
- **Rationale:** The workflow *step* — not "implementation" or "review" — has always been
  this architecture's actual abstraction (D5's whole premise). A per-step dispatch lookup,
  however small or "transitional" its label, is a step-id special case by construction, and
  this change already has one working, generic instruction mechanism
  (`StepContext`/`finishContract`) that makes a second one (semantic prompts, per-step UI
  labels, per-step lane buckets) both redundant and actively wrong the moment a
  non-`implementation`/`review` agent step is authored.
- **Consequences:** Every area/task that referenced `start-agent-step`/`start-human-step`/
  `start-implementation`/`start-review`/an `implementation`↔`review` dispatch mapping/
  "review-appropriate lane"/"Ready for review" as *target* behavior is corrected to the
  generic model above (see the full file list in this pass's own audit, tracked outside
  this decision record). No new archetype/handover/provider-selection/per-step-mode system
  is designed (still out of scope) — `start-step` for an agent step uses one consistent
  existing session/provider default, independent of which step it is, exactly as before
  this correction, just never keyed on step id to *choose* that default.
- **Date:** 2026-09-19 (supersedes the earlier 2026-09-19 version of D15)
- **Affected artifacts:** `overview.md`, `areas/dashboard-server-actions-wiring.md`,
  `areas/execution-readiness-and-session-bootstrap.md`,
  `areas/deterministic-projection-and-human-step.md`, `areas/ui-dashboard-board-split.md`,
  `areas/human-step-surface.md`, `tasks/13-execution-readiness-policy.md`,
  `tasks/14-dashboard-deterministic-action-projection.md`,
  `tasks/15-session-bootstrap-readiness-wiring.md`,
  `tasks/18-deterministic-board-lane-projection.md`,
  `tasks/19-task-card-lifecycle-split.md`,
  `tasks/20-human-step-surface-consolidation.md`.

## D18: Frontend DTO type ownership, and two real, grounded bugs in the existing session service corrected in place

- **Question:** The corrected server projection (D10/D15) needs a matching frontend
  TypeScript type — `tools/dashboard/ui/features/specifications/types.ts` still only models
  the pre-correction shape (`status`/`currentStep`/`attempt`/`workflowState`/
  `availableActions?: string[]`). Which task owns updating it? Separately, a fresh read of
  the actual `tools/dashboard/server/ai/sessions/service.mjs` (not merely the spec's
  description of it) found two real, already-existing bugs relevant to this change's own
  "contextual `taskIds` is never authoritative" and "never fabricate `step`" principles —
  which task corrects them?
- **Grounded fact (2026-09-19):** `AgentSessionService#createSession()` computes
  `const primaryTaskId = options.taskId || (taskIds.length === 1 ? taskIds[0] : undefined);`
  — a single-item contextual `taskIds` array **is** silently promoted to the session's
  authoritative `activeTaskId`/`taskId`, contradicting this change's own "contextual
  `taskIds` is never authoritative execution intent, regardless of list length" principle
  (`areas/execution-readiness-and-session-bootstrap.md`) — the existing code comment
  arguing for this ("a single associated task is unambiguous and may become the active
  task") is exactly the assumption this change rejects. Separately,
  `formatNevoWorkflowContext({ ..., step = 'implementation', attempt = 1 })`'s own default
  parameters, and the `step: deterministicWorkflowInfo?.step || opts.workflowContext?.step
  || 'implementation'` fallback in `AgentSessionService`'s turn-bootstrap path, can inject
  the literal string `'implementation'` for a caller-supplied `workflowContext` override
  object that omits its own `step` — the *automatic*, `resolveDeterministicWorkflowInfo()`-driven
  path is unaffected (that function already fails closed and never returns a workflowInfo
  without a real, resolved `step`), but the fallback values themselves are still dead
  weight that contradicts "never fabricate `step`/`attempt`" and must not remain reachable.
  The turn-bootstrap wording "When implementation and verification are complete…" also
  literally names "implementation" as if every agent step were that one.
- **Decision:**
  1. **Frontend DTO type**: `session-bootstrap-readiness-wiring` (task 15) owns updating
     `types.ts` to the corrected shape (`state`, `executor`, current/next step descriptor,
     `blockedBy`, terminal outcome, human-interaction descriptor, `availableActions?:
     string[]` kept generic) — it is the first frontend task in dependency order that
     actually needs the corrected DTO (it builds the generic agent-execution bootstrap
     against it). `task-card-lifecycle-split` (19) and `human-step-surface-consolidation`
     (20), both later consumers of the same type, add a dependency on task 15 for it.
  2. **`primaryTaskId` single-task bug**: remove the `taskIds.length === 1 ? taskIds[0] :
     undefined` branch entirely — `const primaryTaskId = options.taskId;`. A session's
     `activeTaskId`/`taskId` is authoritative if and only if the caller explicitly supplied
     `options.taskId`; contextual `taskIds` of any length (0, 1, or many) never sets it.
  3. **`'implementation'` fallback removal**: `formatNevoWorkflowContext` requires
     `step`/`attempt` as non-optional parameters (no default values) and throws if either is
     missing, rather than silently defaulting; the turn-bootstrap path's
     `bootstrapToRecord.step`/`.attempt` construction drops the `|| 'implementation'`/`?? 1`
     fallbacks the same way — an explicit `workflowContext` override missing its own `step`
     is a caller error, not a guessable default. Generalize "When implementation and
     verification are complete…" to "When the current step's work and required verification
     are complete…".
  4. Both service.mjs corrections are owned by `execution-readiness-policy` (task 13),
     which already has `tools/dashboard/server/ai/sessions/**` in its allowed paths.
- **Rationale:** These are the same two principles this whole change already establishes
  (contextual selection is never authoritative; deterministic facts are never fabricated),
  found not yet actually true in the one file that implements both — correcting them here
  keeps the spec's own claims accurate against the real, current code rather than the
  code's pre-existing (and, for the single-task case, actively wrong) behavior.
- **Consequences:** New regression coverage: a session created with `taskIds: ['draft-task']`
  and no `taskId` stays ordinary contextual chat — no `activeTaskId`, no readiness check, no
  execution bootstrap, and it must not fail merely because that task isn't executable (this
  is explicitly a *new* test case beyond the existing zero-task/multi-task coverage). An
  explicit `workflowContext` override missing `step` now throws instead of silently
  becoming `'implementation'`.
- **Date:** 2026-09-19
- **Affected artifacts:** `areas/execution-readiness-and-session-bootstrap.md`,
  `tasks/13-execution-readiness-policy.md`,
  `tasks/15-session-bootstrap-readiness-wiring.md`,
  `tasks/19-task-card-lifecycle-split.md`,
  `tasks/20-human-step-surface-consolidation.md`.

## D16: Unconditional human-step submission never fabricates a `result`

- **Question:** A human-owned step may legally have a single unconditional transition
  (`transitions: [{ to: <step>, action: { label: ... } }]`, no `value`) — exactly like
  today's `implementation` step. `finishStep` already rejects a `result` supplied for an
  unconditional step (`UNEXPECTED_TRANSITION_RESULT`). Should `submitHumanStepResult`
  invent a synthetic result value (e.g. `'continue'`) for this case, or omit it?
- **Decision:** Omit it. `submitHumanStepResult` accepts a call with `result` absent when
  the active human step's own transition is unconditional, and passes no `result` through
  to `finishStep` — the same "no result for an unconditional step" contract agent steps
  already use. The human-step projection's tier-2 actions descriptor reflects this: for an
  unconditional human step, its one `actions` entry has no `result` field (only `label`/
  `feedbackRequired`); for a conditional step, every entry has both.
- **Rationale:** Fabricating a placeholder result the workflow definition never declared
  would be exactly the kind of invented-vocabulary problem D5's "engine stays generic"
  principle forbids, and `finishStep` would reject it as an `UNEXPECTED_TRANSITION_RESULT`
  error anyway.
- **Consequences:** `human-step-projection` (task 10), `human-step-execution-operations`
  (task 09), `dashboard-human-step-transport` (task 16), and `HumanStepSurface`
  (task 20) all treat `result` as optional, present only when the active step's
  transitions are conditional (`transitions.length > 1` or a single transition with a
  declared `value`).
- **Date:** 2026-09-19
- **Affected artifacts:** `areas/deterministic-projection-and-human-step.md`,
  `areas/step-executor-model.md`, `areas/dashboard-server-actions-wiring.md`,
  `areas/human-step-surface.md`, `tasks/07-workflow-definition-schema-extensions.md`,
  `tasks/09-human-step-execution-operations.md`, `tasks/10-human-step-projection.md`,
  `tasks/16-dashboard-human-step-transport.md`, `tasks/20-human-step-surface-consolidation.md`.

## D17: `HumanStepSurface` lives in `shared/`, not in a feature — its transport is one neutral function plus per-feature adapters

- **Question:** Pass 3 placed the reusable `HumanStepSurface` under
  `tools/dashboard/ui/features/specifications/tasks/human-step-surface.tsx` while also
  requiring `features/agent-sessions/` (the chat surface) to import it directly, and placed
  its client transport hook under `features/agent-sessions/queries.ts` while requiring
  `features/specifications/` to call it too. Both are direct sibling-feature imports —
  confirmed, by reading `tools/dashboard/tests/architecture-boundaries.test.mjs` directly,
  to be exactly what its test 1 ("Sibling feature isolation: `features/**` has zero imports
  from other features") asserts against, unconditionally. Where should this component and
  its transport actually live?
- **Grounded fact (2026-09-19):** the repository already has a `shared/` layer
  (`shared/ui/` — presentational primitives; `shared/lib/` — pure utilities) that both
  `features/specifications/` and `features/agent-sessions/` already import from, and the
  same boundary test's test 2 ("Shared layer purity") confirms `shared/**` may never import
  `features/**`/`screens/**`/`routes/**`/`app/**` in return — a one-way dependency, exactly
  the shape needed here. No feature currently has a project-wide neutral request helper;
  each feature's `queries.ts` calls `fetch()` directly today.
- **Decision:** `HumanStepSurface` moves to `tools/dashboard/ui/shared/workflow/human-step-surface.tsx`
  — purely presentational, importing only `shared/ui`/`shared/lib`, never fetching itself,
  never knowing a route URL, a literal step id, or "approve"/"request-changes." The
  transport splits in two: one neutral, feature-agnostic request function,
  `tools/dashboard/ui/shared/lib/human-step-request.ts` (owned by
  `dashboard-human-step-transport`, D14's task, alongside the server route it calls),
  exposing the raw POST call with no React/query-cache concerns; and one thin, independently
  owned React Query hook *per feature* (`features/specifications/tasks/human-step-mutations.ts`,
  `features/agent-sessions/human-step-mutations.ts` — owned by
  `human-step-surface-consolidation`) that each wrap the same shared function in their own
  feature's `useMutation`/cache-invalidation concerns. Neither feature imports the other's
  hook file; both import only the shared presentational component and the shared request
  function.
  **Prop contract corrected 2026-09-20 (this pass) to agree with D19/D20 — the original
  `{ stepDescriptor, interaction, loading, error, onStart, onSubmit }` shape below is
  obsolete and must not be reintroduced:**
  ```
  HumanStepSurface({ interaction, loading, error, onSubmit })
  ```
  `HumanStepSurface` owns only an **active** human interaction (`interaction` non-null) —
  waiting-for-step-start is not part of this component at all, so it has no
  `stepDescriptor`/`onStart` prop and never will (D20 narrowed its scope to the
  active-interaction case specifically, to resolve the direct contradiction between the
  pass-5 versions of tasks 19/20 over who renders the board's/dialog's waiting state). The
  generic waiting control (`availableActions` includes `"start-step"` + the step descriptor
  → one generic "Start" control, dispatching by `executor` — agent → the agent execution
  path; human → `startHumanStep`) is owned by each caller (`TaskCard`, `TaskDialog`, chat)
  directly, calling its own `onStartStep`/equivalent callback (D19) — never a second,
  unused `onStart` prop threaded through `HumanStepSurface` itself. The two feature-local
  adapter hooks correspondingly narrow: `features/specifications/tasks/human-step-mutations.ts`
  provides `TaskDialog`'s active-human-interaction result submission only (`onSubmit`);
  `features/agent-sessions/human-step-mutations.ts` provides the same for chat's active
  interaction, and *additionally* exposes a `start` method chat's own generic waiting
  control calls directly for a human-owned step (chat never needs the composition-layer
  indirection the board/dialog case requires, since it already lives inside
  `features/agent-sessions` and never crosses into `features/specifications`).
- **Rationale:** The alternative — weakening or special-casing the architecture-boundaries
  test for this one component — was explicitly ruled out by the corrective-pass request
  itself. Splitting transport into "one neutral function, N thin feature-local callers" is
  the same shape this repository's `shared/ui` primitives already use for cross-feature
  reuse; it needed no new pattern invented. Narrowing the component's own prop contract
  (this pass) removes a prop (`onStart`) that, once D19's composition-level dispatcher and
  D20's TaskCard-indicator model were settled, no caller ever actually wired — keeping it
  would have been dead surface area, not a real option two callers chose between.
- **Consequences:** `dashboard-human-step-transport` (task 16)'s allowed paths move from
  `features/agent-sessions/queries.ts` to `shared/lib/human-step-request.ts`.
  `human-step-surface-consolidation` (task 20)'s allowed paths move from
  `features/specifications/tasks/human-step-surface.tsx` to
  `shared/workflow/human-step-surface.tsx`, plus the two new feature-local mutation-hook
  files. `node --test tools/dashboard/tests/architecture-boundaries.test.mjs` is added to
  both tasks' own verification. The generic waiting-state "Start" control's own
  implementation is out of `HumanStepSurface`'s scope entirely — it is owned by whichever
  task owns each caller (`task-card-lifecycle-split` for `TaskCard`;
  `human-step-surface-consolidation` for `TaskDialog` and chat;
  `specification-detail-composition-wiring` for the board/dialog dispatcher's real
  implementation, D19).
- **Date:** 2026-09-19 (placement/transport-split decision); prop contract corrected
  2026-09-20 to agree with D19/D20, superseding this decision's original prop-shape wording
  in place (not a parallel entry — the placement/transport-split reasoning above is
  unchanged and still governs).
- **Affected artifacts:** `areas/human-step-surface.md`,
  `tasks/16-dashboard-human-step-transport.md`, `tasks/20-human-step-surface-consolidation.md`.

## D19: One composition-level `startStep` dispatcher per screen; `TaskCard`/`TaskDialog` only ever call `onStartStep`

- **Question:** D15 (corrective pass 5) established that the server-side/UI *model* has
  exactly one generic `start-step` action, branching only on `executor`. Pass 5 did not,
  however, finish wiring that action to all three real UI entry points — `TaskCard`, the
  board's cards; `TaskDialog`, opened from the board; and the chat surface
  (`AgentSessionChatSurface`) — leaving the actual client code that was read as part of this
  pass still on the obsolete pre-D15 vocabulary. Who dispatches `start-step` by executor
  protocol from each of these three surfaces, without a `features/specifications` file
  importing `features/agent-sessions` (forbidden by
  `tools/dashboard/tests/architecture-boundaries.test.mjs`'s sibling-feature-isolation test)?
- **Grounded fact (2026-09-20, this pass):** `tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx`
  already legally imports **both** `features/specifications` (`TaskDialog`) and
  `features/agent-sessions` (`useCreateAgentSession`, `queueAgentSessionInitialDispatch`,
  `pendingActionModeStore`) — confirmed by reading its import block — because a screen sits
  above both features in the layer direction `architecture-boundaries.test.mjs` enforces (the
  test only forbids feature→feature and feature→screen imports, never screen→feature). Its
  existing `handleWorkflowAction(task, action)` is a literal `if/else if` string-branch on
  `'start-implementation'`/`'start-review'`/`'approve'`/`'request-changes'` that constructs
  step-id-derived prompts (`` `Implement task ${task.id}: ${task.title}` ``,
  `` `Review task ${task.id}: ${task.title}` ``) and, for `'approve'`, POSTs directly to the
  legacy `/workflow/human-decision` route — exactly the pattern D15 already removed
  server-side, still live client-side. The same pattern repeats in
  `tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx`'s
  `handleStartReviewTask` (sends the literal prompt `` `Review task ${taskId}` `` via
  `assistant.sendTurn(..., { mode: 'agent' })`) and
  `agent-session-chat-surface.tsx`'s `availableActions.includes('start-review')`/
  `('approve')`/`('request-changes')` rendering block, which calls `onStartReviewTask`/
  `onApproveTask`/a `request-changes` composer mode. `TaskDialog`
  (`features/specifications/tasks/task-dialog.tsx`) has no deterministic awareness and no
  `onStartStep`-shaped prop at all today — only the pre-existing legacy `executeTaskAction`/
  `TaskActionFooter` path, which stays unchanged (D7).
- **Decision:** Each screen that composes both features owns exactly one generic dispatcher,
  branching only on `stepDescriptor.executor` — never on `step.id`/`currentStep`/`nextStep`:
  - `specification-detail-content.tsx` renames/rewrites `handleWorkflowAction` into
    `startStep(task, stepDescriptor)`: for `executor: 'agent'`, create/reuse the task's
    authoritative execution session and send the one generic trigger message (unchanged from
    D15's session-bootstrap decision); for `executor: 'human'`, call `startHumanStep`
    directly through the shared, neutral `human-step-request.ts` function (D14/D17) — no
    session is created or bound. This single function is passed down as one `onStartStep`
    prop to both `StatusBoard`→`TaskCard` (board entry point) and the newly added
    `onStartStep` prop on `TaskDialog` (dialog entry point) — neither component branches on
    executor itself; both only ever call `onStartStep(stepDescriptor)`.
  - The prior `'approve'`/`'request-changes'` branches in `handleWorkflowAction` (the old
    human-verification-gate action vocabulary D5 already superseded) are removed outright,
    not preserved — the equivalent behavior (submitting an *active* human interaction's
    result) is owned entirely by `HumanStepSurface`'s own `onSubmit`, reached only through
    `TaskDialog`/chat (D7), never through this board-level dispatcher.
  - `agent-session-page.tsx` renames `handleStartReviewTask` to a generic name (e.g.
    `handleStartAgentStep`) and replaces its literal `` `Review task ${taskId}` `` prompt
    with the same generic trigger wording used by the board/dialog path. Because chat already
    operates inside `features/agent-sessions` for a session already bound to the task, its
    dispatcher only ever needs the agent branch — a human-owned step's "start" and "submit"
    in chat go through that feature's own `human-step-mutations.ts` adapter hook (D17)
    directly, with no composition-layer indirection needed (chat never crosses the
    specifications/agent-sessions boundary the board/dialog case does). `agent-session-chat-surface.tsx`
    renames the corresponding prop (`onStartReviewTask` → `onStartAgentStep`) and removes the
    `'approve'`/`'request-changes'`/`'start-review'` literal-action-id rendering block
    entirely, replacing it with: a generic waiting-step bar (works for both executors, the
    human branch calling the feature's own adapter hook's `start`) and `HumanStepSurface` for
    an active human interaction.
  - `TaskCard`/`TaskDialog` (`features/specifications`) never import
    `features/agent-sessions` or the human-step transport directly — both only ever receive
    and call `onStartStep`/an equivalent callback prop supplied from the screen above them.
- **Rationale:** Reuses the *existing* prop-bubbling pattern already present
  (`onWorkflowAction` → `StatusBoard`) rather than inventing new plumbing — only the internal
  branch predicate changes, from an action-string comparison to an `executor` comparison.
  Keeps `TaskCard`/`TaskDialog` presentational and within `features/specifications`'s own
  boundary, matching the architecture-boundaries test's actual, verified rules rather than a
  new one.
- **Consequences:** Without this decision, a human-owned step's "Start" control anywhere in
  the UI would be a dead click (D15's model already existed server-side with no client caller
  reaching it) — this decision is what makes it real.
  **Task-decomposition correction (2026-09-20, seventh pass — the architectural decision
  above is unchanged; only which task owns which file is corrected):** the original version
  of this decision packed the actual `startStep`/renamed-chat-handler *implementations* into
  `session-bootstrap-readiness-wiring` (task 15) alongside `TaskCard`'s/`TaskDialog`'s
  *contracts* — but those contracts are introduced by `task-card-lifecycle-split` (task 19)
  and `human-step-surface-consolidation` (task 20), both of which *depend on* task 15. That
  made task 15 consume a prop/API only its own dependents introduce — an unsatisfiable
  ordering, not just an awkward one. Corrected as: task 15 narrows to a producer-only task
  (the frontend DTO type plus a pure `buildAgentStepTriggerMessage(taskId)` primitive, no
  `specification-detail-content.tsx`, no `agent-session-page.tsx`); a new final task,
  `specification-detail-composition-wiring` (order 23, depends on `session-bootstrap-readiness-wiring`,
  `dashboard-human-step-transport`, `task-card-lifecycle-split`, and
  `human-step-surface-consolidation` — all four already-existing contracts), owns
  `specification-detail-content.tsx`'s real `startStep` dispatcher and its wiring into
  `StatusBoard`/`TaskDialog`; `human-step-surface-consolidation` (task 20) gains
  `agent-session-page.tsx` (previously, incorrectly, assigned to task 15) alongside
  `agent-session-chat-surface.tsx`, so the parent-handler rename and the child's prop-rename
  happen inside the one task that owns both files, never split across a producer/consumer
  boundary. `session-bootstrap-readiness-wiring`'s now-unneeded dependency on
  `dashboard-human-step-transport` is removed from `change.yaml` (the human branch's
  `startHumanStep` call moved to the new final task, which depends on
  `dashboard-human-step-transport` directly instead).
**Composition-path correction (2026-09-20, eighth pass — task 23's own scope, not the
architecture above, was wrong):** the seventh pass assumed `specification-detail-content.tsx`
renders `StatusBoard` directly. **Grounded fact:** it does not — reading both files directly
shows `specification-detail-content.tsx` renders `SpecificationOverview`
(`tools/dashboard/ui/screens/specification-detail/specification-overview.tsx`), which itself
renders `StatusBoard` and owns the actual `onWorkflowAction?: (task, action: string) => void |
Promise<void>` prop that gets forwarded into it — `TaskDialog`, by contrast, *is* rendered
directly by `specification-detail-content.tsx`, no intermediate file. A task 23 that owned
only `specification-detail-content.tsx` could wire `startStep` into `TaskDialog` but had no
file in its `allowed_paths` capable of forwarding it into `StatusBoard`. Corrected: task 23's
`allowed_paths` gains `specification-overview.tsx`; the composition chain is
`SpecificationDetailContent.startStep` → `SpecificationOverview.onStartStep` →
`StatusBoard.onStartStep` (a pure rename/forward in `SpecificationOverview`, replacing its
`onWorkflowAction` prop) → `TaskDialog` receives the same `startStep` directly, no hop.
**Grounded fact confirming this is safe:** `onWorkflowAction` is read only inside
`TaskCard`'s `isDeterministic` branch — `SpecificationOverview`/`StatusBoard` each have a
wholly separate, `SpecificationOwnerAction`-typed `onDirectTaskAction`/`onTaskAction` pair
legacy cards use instead, confirmed by reading both files — so this rename cannot affect
legacy behavior, and task 23's own acceptance criteria now prove that directly.

**Task 20 real-vs-test-double correction (2026-09-20, eighth pass):** task 20 had claimed
"activating from either entry point [`TaskDialog` or chat] POSTs the same `{action:
'start'}` body identically" — but `TaskDialog`'s `onStartStep` is, by this same decision's
own design, only a test double until task 23 supplies the real implementation; task 20
cannot prove what a callback it doesn't implement actually does over the wire. Corrected:
task 20 now proves (a) active-interaction *submission* identically for both `TaskDialog` and
chat (a claim it can make — both go through its own feature-local adapters), (b) chat's own
waiting-state *activation* for real (chat is fully self-contained within task 20, D19), and
(c) `TaskDialog`'s waiting-state control only calls `onStartStep` with a test double. The
real `TaskDialog`→`human-step-request.ts`→`{action: 'start'}` proof moves to task 23,
alongside the equivalent, already-present proof for `TaskCard` — both real composition entry
points are asserted to route through the identical `startStep` function instance.
- **Date:** 2026-09-20; task-decomposition corrected 2026-09-20 (seventh, strictly
  mechanical pass); composition-path and task 20/23 ownership refined further 2026-09-20
  (eighth, strictly mechanical pass).
- **Affected artifacts:** `change.yaml`, `tasks/15-session-bootstrap-readiness-wiring.md`,
  `tasks/19-task-card-lifecycle-split.md`, `tasks/20-human-step-surface-consolidation.md`,
  `tasks/23-specification-detail-composition-wiring.md` (new),
  `areas/execution-readiness-and-session-bootstrap.md`, `areas/human-step-surface.md`,
  `areas/ui-dashboard-board-split.md`.

## D20: `DeterministicTaskCard` never embeds the active human-interaction result form — it indicates and defers to `TaskDialog`

- **Question:** `tasks/19-task-card-lifecycle-split.md` (as left after pass 5) required
  `DeterministicTaskCard`'s footer to render an active human interaction's own result buttons
  (`label`/`feedbackRequired` per action) directly on the board card. `tasks/20-human-step-surface-consolidation.md`
  simultaneously lists "wiring `HumanStepSurface` from the task board" as future/out-of-scope
  work. Rendering the interaction's own action buttons on the card *is* a second,
  independent implementation of the same interaction surface `HumanStepSurface` exists to be
  the one owner of (D7/D11) — a genuine internal contradiction between the two tasks, not
  just a wording gap.
- **Decision:** `DeterministicTaskCard`'s scope shrinks to: the state-derived status
  label/tone (unchanged from D15/pass-5 scope), the step descriptor (`id`/`purpose`) when
  waiting, one generic "Start" control calling `onStartStep(stepDescriptor)` for
  `availableActions: ["start-step"]` — identical for both executors — and, for an active
  human interaction, a compact **indicator only** (e.g. "Human action required" text/badge)
  that opens `TaskDialog` on click rather than rendering the interaction's own result buttons
  inline. `HumanStepSurface` is not imported into `features/specifications/detail/status-board.tsx`
  or any `TaskCard` sub-component — it remains reachable only through `TaskDialog` and chat
  (D7, unchanged). This is a genuine scope reduction from the pass-5 version of task 19, not
  a preservation of its prior wording.
- **Rationale:** Keeps exactly one implementation of the full interaction surface
  (`HumanStepSurface`, D7/D11) rather than a second, board-local one that would have to be
  kept in sync with it by hand; the board's job is to summarize state and route the user to
  the one place that has the full surface, not to duplicate it.
- **Consequences:** `tasks/19-task-card-lifecycle-split.md`'s acceptance criterion claiming
  the card's "footer renders... the human-interaction descriptor's own actions for an active
  human step" is replaced with the indicator-only requirement. This does not change
  `human-step-surface-consolidation`'s own "out of scope: wiring `HumanStepSurface` from the
  task board" statement — that statement is still true (the board never renders the full
  surface); it now sits alongside, not in tension with, the board's separate generic
  `onStartStep` wiring (D19), which is a different, smaller mechanism than embedding
  `HumanStepSurface`.
- **Date:** 2026-09-20
- **Affected artifacts:** `tasks/19-task-card-lifecycle-split.md`, `areas/ui-dashboard-board-split.md`.

## D21: First explicit Start must let the user choose provider/execution mode; the choice becomes a persisted execution policy

- **Question:** The first real dogfooding run of `ai-spec-history` had `startStep()` silently
  pick a default provider and omit `mode` entirely, which the provider contract then defaults
  to `'edit'` (`DEFAULT_AGENT_EXECUTION_MODE`, unchanged, `contracts.mjs`) — a real Claude
  session in `edit` mode cannot satisfy `workflow step start`'s command-approval requirement
  through the dashboard's non-interactive dispatch, so the workflow repeatedly stalled with
  "This command requires approval" until the user manually switched the session to `agent`
  mode. Should `start-step` keep silently defaulting, or must it give the user an explicit
  choice — and if so, how, without inventing a second provider-configuration system or a
  per-step mode mapping?
- **Grounded fact (2026-09-21):** `CreateAgentSessionDialog`
  (`features/agent-sessions/create-agent-session-dialog.tsx`) already has exactly this
  selection UI (provider list + `AGENT_EXECUTION_MODES` picker, its own sensible default-mode
  logic), but is wired only to the generic "new session" affordance in `SpecificationOverview`
  — `startStep()` never opens it. No existing concept persists a resolved provider/mode choice
  per task or change; every session creation call re-supplies (or omits) `provider`/`mode`
  independently.
- **Decision:** The first explicit `start-step` for an `executor: agent` step, when the
  provider's permission model requires an execution-mode choice (i.e., the omitted-mode
  default would not satisfy the deterministic command-approval requirement), must present the
  same provider/mode selection `CreateAgentSessionDialog` already offers — reusing that
  existing concept, not a second one — before creating the session. Once resolved, the
  provider + mode choice is persisted as the task's (or change's, if the owner later chooses
  that scope during implementation) **execution policy**, so subsequent automatic handovers
  (D25) reuse it without re-asking. The existing provider contract is unchanged: an omitted
  mode still defaults to `'edit'` wherever no execution policy has been resolved yet (e.g. the
  generic "new session" path). No step-id-specific mode mapping is introduced — the policy is
  keyed by task/change and provider, never by step id.
- **Rationale:** Matches the constraint set given directly for this corrective pass: don't
  silently escalate to "agent," give the user the choice when the provider permission model
  requires it, don't violate the existing default-to-`edit` contract, reuse existing
  selection UI rather than inventing a parallel one, and don't ask the same question at every
  automatic handover.
- **Consequences:** `start-step`'s dispatcher gains a readiness check: "does an execution
  policy already exist for this change/provider?" If not, and the provider's permission model
  needs an explicit mode, show the selection UI instead of creating a session directly.
- **Corrected 2026-09-21 (pass 10 — scope and transport, no longer deferred):** "task or
  change, decided during implementation" is resolved: the execution policy's canonical scope
  is **the change/specification**, not the task — `{provider, mode}` resolved from the first
  explicit Start (or batch Start) applies to every task in the spec's sequential queue (D33)
  and every automatic handover, since the single-execution invariant (D33) means only one
  execution is ever active for the spec at a time regardless of which task it belongs to.
  Optional per-task overrides may layer on top of the change-level default (e.g. a task that
  genuinely needs a different provider), but the change-level default is the only policy
  persisted by default — task-level entries are additive exceptions, never the primary
  storage. Persisted server-side at `.nevo-ai-local/execution-policy/<change>.json`
  (git-ignored local runtime convention, same family as
  `.nevo-ai-local/workflow-operations/**`), shape `{provider, mode, taskOverrides?: {
  [taskId]: {provider?, mode?} }}`, atomic temp-file-then-rename writes matching
  `operation-record.mjs`'s existing pattern. A real server transport owns read/write — a new
  route (e.g. `GET`/`PUT /api/specs/:slug/execution-policy`) backed by a small service module
  — the browser never reads/writes the local file directly. "Fresh reviewer session" (D26) is
  independent of this policy: a fresh session still uses the same resolved provider/mode
  unless a task-level override says otherwise — freshness and provider selection are
  orthogonal axes, never conflated.
- **Corrected 2026-09-22 (pass 11 — remove the "if the provider needs it" condition; always
  ask on first Start):** conditioning the picker on "does the provider's permission model
  need an explicit mode choice" was itself wrong — provider *selection* is part of what's
  unresolved when no change-level policy exists, so a per-provider capability check can't run
  first without already assuming an answer to the question it's supposed to gate. Corrected
  rule: whenever a change has **no** resolved execution policy, the first explicit
  `start-step`/batch-Start **always** shows the provider + mode picker (sensible defaults
  preselected, e.g. the first available provider and its own default mode) — never
  conditionally. The user confirms (accepting the defaults counts as confirming); the result
  persists as the change-level policy exactly as already specified above. Every subsequent
  queued item and automatic handover reuses it without asking again, unless a task-level
  override applies.
- **Date:** 2026-09-21 (transport/scope corrected 2026-09-21, pass 10; unconditional picker
  corrected 2026-09-22, pass 11)
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/26-execution-policy-and-mode-selection.md`.

## D22: `StepContext` gains an explicit `taskDefinition` field — the agent never rediscovers its own task file

- **Question:** `compileStepContext()`'s returned `task` field is only the task id string
  (confirmed by reading the function directly) — an executing agent has no way to reach its
  own task file's path or content from the `workflow step start` payload alone, even though
  `change.yaml → tasks[].file` deterministically names it.
- **Grounded fact (2026-09-21):** the (separate, legacy) `buildContextPacket()`
  (`tools/specs/context.mjs`) already resolves `task.file` via `resolveWithinBase(changeDir,
  task.file)` and reads its frontmatter for the legacy path — the resolution logic already
  exists in the codebase, just not connected to `compileStepContext()`.
- **Decision:** `compileStepContext()`'s return value gains `taskDefinition: {id, path,
  content}` — `path` relative to the repository root, `content` the task file's full raw
  text. The agent must never need to discover the task filename by searching the repository.
- **Rationale:** Directly closes the gap the corrective-pass brief named: "Spec Writer
  performs discovery once → task contains the execution contract → execution receives that
  contract directly."
- **Consequences:** `step-context.mjs` reuses the existing `resolveWithinBase`/file-read
  pattern already proven by `buildContextPacket()`/`publish/operation.mjs`'s own task-file
  loading, rather than inventing a new one.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/agent-step-bootstrap-and-context.md`,
  `tasks/24-agent-step-bootstrap-and-context.md`.

## D23: `StepContext` models task-declared `requiredContext` distinctly from routing-derived `relevantDocs`

- **Question:** The task's own frontmatter declares `context.required` (e.g. `overview.md`,
  a specific `areas/*.md`, `owner-decisions.md`) — the exact documents the Spec Writer already
  selected for this task's execution. `compileStepContext()`'s `relevantDocs` is unrelated:
  purely routing-rule matches against the task's affected paths (`resolveRelevantDocs`,
  confirmed by reading the function). Should these stay conflated, or become two explicit
  fields?
- **Decision:** Two distinct fields. `requiredContext` — sourced directly from the task
  frontmatter's `context.required` (and `context.optional`, if the loader already
  distinguishes them) — is part of the task's execution contract; it is never replaced or
  filtered by routing inference. `relevantDocs` is unchanged in meaning and computation
  (routing-derived repository rules/instructions) and stays a separate field — neither field
  replaces the other.
- **Rationale:** Matches the corrective-pass brief exactly: "Model two different concepts
  explicitly... They are not interchangeable."
- **Consequences:** `agent-step-bootstrap-and-context` (task 24) reuses the existing
  frontmatter-loading path (`loadTaskFrontMatter`/`parseFrontMatterFile`, already used by
  `buildContextPacket()`) rather than re-deriving `context.required` a second way.
- **Corrected 2026-09-21 (pass 10 — content-bundling finalized, no longer deferred):**
  "bundle inline vs. paths-only, evaluate against payload size during implementation" is
  resolved now: `requiredContext` entries carry **path + content inline**, exactly like
  `taskDefinition` (D22) — the same invariant applies to both: *the agent must not perform
  repository discovery to determine which task or required-context documents it is supposed
  to read.* Evaluated against real `ai-spec-history` task sizes (task 01's own
  `context.required` names three documents — `overview.md`, one `areas/*.md`, `owner-
  decisions.md` — each realistically a few KB to tens of KB in this repository's own specs);
  inlining a handful of such documents is materially smaller than the routing-derived
  `relevantDocs`/`instructions` payload `StepContext` already sends today, so there is no
  payload-size justification for the paths-only fallback. If a future task's declared
  `context.required` set becomes large enough to matter, that is a reason to revisit *task
  authoring practice* (narrower `context.required`), not to weaken this contract.
- **Date:** 2026-09-21 (content-bundling finalized 2026-09-21, pass 10)
- **Affected artifacts:** `areas/agent-step-bootstrap-and-context.md`,
  `tasks/24-agent-step-bootstrap-and-context.md`.

## D24: `StepContext` exposes only agent-relevant source-control facts; `finishContract` keeps one canonical field

- **Question:** `context.sourceControl` in `compileStepContext()` is
  `CommitAndPushAction.check()`'s full internal factual context, including `existingCommits`
  (effectively full branch history from `main`) — confirmed by reading
  `normalizeSourceControlFacts()`, the one shared normalizer both `compileStepContext` and
  `planFinish` consume. Separately, `finishContract.parameters` and
  `finishContract.requiredInputs` are, as implemented, the identical object reference
  (`requiredInputs: parameters`) — confirmed by reading `compileStepContext`'s return
  statement directly. Should the public `StepContext` keep exposing everything the internal
  finalize action computes, and both duplicate field names?
- **Decision:** `StepContext`'s `context.sourceControl` is trimmed to only what an executing
  agent genuinely needs to act (at minimum: `currentBranch`, `changedFiles`,
  `taskAffectedFiles` — `existingCommits`/full branch history is dropped from the agent-facing
  payload). The full factual context `CommitAndPushAction.check()` computes remains available
  internally to `finish-operation.mjs`'s own finalize/commit/push decision-making — this
  decision trims what is *exposed*, not what the engine internally computes or relies on for
  correctness. `finishContract` keeps exactly one canonical field, `parameters` —
  `requiredInputs` is dropped as a pure duplicate unless implementation discovers a real
  external consumer that needs the separate name (in which case that consumer, not this
  decision, is wrong and gets fixed instead).
- **Rationale:** Matches the brief: "smaller, execution-relevant `StepContext` … not removal
  of correctness information from the workflow engine" — and "prefer one canonical
  representation unless a real consumer requires both."
- **Consequences:** `normalizeSourceControlFacts()` gains (or is wrapped by) an
  agent-facing projection distinct from the internal shape `planFinish` already consumes
  unchanged.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/agent-step-bootstrap-and-context.md`,
  `tasks/24-agent-step-bootstrap-and-context.md`.

## D25: Declarative per-transition continuation policy; a new orchestration layer, not `finishStep`, creates follow-on sessions

- **Question:** After `workflow step finish` transitions a task to `waiting-for-step-start`
  with a known `nextStep` and no owner decision required (e.g. `implementation → review`),
  nothing today creates the next session — confirmed absent by reading
  `agent-session-page.tsx`/`agent-session-chat-surface.tsx` directly; the user must click
  "Start" again. Should `finishStep()` itself create the next session, or should a separate
  layer own this, and how does the *workflow definition* (not application code) declare
  which transitions continue automatically?
- **Decision:** `.nevo-ai/workflows/*.yaml` transitions gain an additive field,
  `continueOnSuccess: auto | owner-action` (default `owner-action` when absent, so every
  existing definition is unaffected until explicitly migrated — the same additive-migration
  discipline as D6/D9). A new orchestration layer — explicitly **not** `finishStep()` itself —
  observes the result of a finish operation and, when the matched transition declares
  `continueOnSuccess: auto`, creates or reuses the next step's session (per D26's session
  policy) and issues the generic trigger (D15, unchanged: never a step-id-derived semantic
  prompt). `finishStep()` remains provider-neutral and creates no AI sessions itself — the
  engine stays deterministic; only the new orchestration layer is provider/session-aware.
- **Rationale:** Directly matches the brief's explicit constraint: "Do not make `finishStep()`
  itself create AI sessions. Keep the engine deterministic and provider-neutral. Instead
  design an orchestration layer that consumes the resulting workflow position" — and "The
  workflow definition must be able to declare the intended behavior rather than application
  code inferring it from step names."
- **Consequences:** No `if (nextStep === 'review')` or equivalent step-name dispatch is
  introduced anywhere (same invariant D15 already established, extended to this new layer).
- **Corrected 2026-09-21 (pass 10 — field renamed, semantics narrowed, full migration
  decided):** `continueOnSuccess` was semantically wrong — continuation matters just as much
  for a *failing* result (`review` fail → `implementation`, `human-verification`'s "Request
  changes" → `implementation`) as for a passing one. Renamed to **`continuation: auto |
  owner-action`** (default `owner-action` when absent, unchanged backward-compat), legal only
  on an internal (step-to-step) transition — a terminal transition has no next position to
  continue to, so the field is never written there. **`continuation: auto` means only that no
  owner decision is required before the destination position may be scheduled — it does
  **not** mean the destination executes immediately.** Whether it executes next, or waits
  behind other runnable work, is the sequential queue's own scheduling decision (D33/D34),
  never this field's concern; conflating "no owner action needed" with "run this next" was
  the mistake corrected here. Full `standard-v1.yaml` migration (auditing every internal
  transition, not only `implementation → review`): `implementation`'s `to: review` →
  `continuation: auto`; `review`'s `value: fail, to: implementation` → `continuation: auto`;
  `review`'s `value: pass, to: human-verification` → `continuation: auto` (destination is
  human-owned — D27 auto-activates it, then pauses for the real decision);
  `human-verification`'s `value: fail, to: implementation` ("Request changes") →
  `continuation: auto`. `human-verification`'s `value: pass, to: verified` is terminal — no
  `continuation` field. The orchestration layer that acts on `continuation: auto` is
  server-side (D35), not `finishStep()` and not a React callback.
- **Date:** 2026-09-21 (field renamed and full migration decided 2026-09-21, pass 10)
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/25-workflow-continuation-schema.md`, `tasks/29-automatic-workflow-continuation.md`,
  `.nevo-ai/workflows/standard-v1.yaml`.

## D26: Declarative session-reuse policy, session lineage, and execution role — review uses a fresh session

- **Question:** Session selection for starting a step currently matches only on `taskId`
  (`binding-service.mjs`'s `listSessions`/`listSessionsSync`, confirmed by reading the filter
  directly) — `binding.step` exists but is never used as a selection filter, so review can
  silently reuse the implementer's own conversational session. No `parentSessionId`/session-
  lineage or execution-role concept exists anywhere in `tools/dashboard/server/ai/**`
  (confirmed absent by grep). How should "independent reviewer" be modeled without requiring a
  different provider and without deriving it from a literal step name?
- **Decision:** A declarative `execution: {session: reuse | fresh, role: <string>}` object on
  the **transition** (not the step — see correction below) determines whether the
  orchestrator (D25/D35) reuses the previous session or creates a fresh one, and which role
  the new session plays. `standard-v1.yaml`'s `implementation → review` transition sets
  `execution: {session: fresh, role: reviewer}`.
- **Rationale:** Matches the brief precisely: reuse the existing canonical session identity
  for lineage rather than a new one; support at least reuse/fresh; assign roles from
  declared semantics, never step-name derivation; independence is about session freshness,
  not a forced provider change.
- **Consequences:** `listSessions`/`listSessionsSync`'s `taskId`-only filter is unaffected by
  this decision (still correct for "show me every session touching this task" — a UI listing
  concern); the orchestrator's own "which session do I hand off to" decision is a separate,
  new consumer of `execution`/`parentSessionId`, not a change to the existing list filter's
  semantics.
- **Corrected 2026-09-21 (pass 10 — canonical location settled, role de-hardcoded):**
  "on a step (or, if cleaner, the entering transition) — decide during implementation" left a
  real ambiguity unresolved: `implementation` has **two** distinct inbound transitions
  (`review`'s fail branch, `human-verification`'s "Request changes" branch) that may
  legitimately want different session policies for the same destination step. Settled: the
  **transition** is the sole canonical location — consistent with `outcome` (D9),
  `releasesDependencies` (D28), and `continuation` (D25) all already living there, and it is
  the only location expressive enough for `implementation`'s two different inbound cases.
  Steps carry only `executor` (agent|human, protocol) — never session/role metadata. `role`
  is a free-form, workflow-declared identifier — never a closed application enum — so a
  future workflow can introduce a role this repository has never seen without an application
  code change; `implementer`/`reviewer`/`refiner` are `standard-v1`'s own chosen values, not
  reserved words. Full `standard-v1.yaml` migration: `implementation → review`:
  `execution: {session: fresh, role: reviewer}`; `review` fail → `implementation`:
  `execution: {session: fresh, role: refiner}`; `human-verification` fail (Request changes)
  → `implementation`: `execution: {session: fresh, role: refiner}`. `review` pass →
  `human-verification` carries no `execution` (destination is human-owned; D12 unchanged —
  starting a human step never creates a session).
- **Date:** 2026-09-21 (canonical location and role extensibility settled 2026-09-21, pass 10)
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/25-workflow-continuation-schema.md`, `tasks/29-automatic-workflow-continuation.md`,
  `.nevo-ai/workflows/standard-v1.yaml`.

## D27: The orchestrator auto-activates a human-owned step on arrival; the redundant manual "Start" click is removed

- **Question:** Reaching a human-owned step's `waiting-for-step-start` state today requires a
  user to click a generic "Start" control before the real, definition-driven interaction
  (`HumanStepSurface`) appears — confirmed by reading `status-board.tsx`/
  `agent-session-chat-surface.tsx`/`specification-detail-content.tsx`'s
  `postHumanStepAction({action:'start'})` call sites directly. That first click carries no
  user-level meaning; it only activates internal workflow state. Should it stay a required
  manual step?
- **Decision:** No. When the orchestrator (D25) reaches a position where `nextStep`'s executor
  is `human`, it calls the existing `startHumanStep` operation itself (D12's existing
  operation, unmodified) immediately, then pauses. The dashboard shows the real
  `HumanStepSurface` interaction directly — the user's first and only click is a genuine
  decision (Approve/Request changes/whatever the definition declares), never a no-op
  activation step. `startHumanStep` itself is unchanged; only who calls it (and when) changes.
- **Rationale:** Matches the brief exactly: "the human step should normally be activated
  automatically... Preserve the domain operation `startHumanStep()`, but do not require a
  redundant explicit UX action merely to call it."
- **Consequences:** No hardcoded "Approve"/"Request changes" is introduced by this change —
  `HumanStepSurface`'s existing definition-driven rendering (Finding 8, confirmed correct,
  unchanged) is exactly what appears once auto-activation completes.
- **SUPERSEDED IN MECHANISM 2026-09-22 (pass 12) — see D47.** "Calls `startHumanStep`
  itself... then pauses" is wrong: `startHumanStep` mutates `change.yaml` with no commit of
  its own, and D45 (pending human decisions don't block other agent-owned work) makes it
  possible for a different task's own commit to sweep that uncommitted mutation in — the same
  bug D29 fixed for Publish. D47 corrects the *mechanism*, not the *goal* this decision states
  (no redundant manual "Start" click; the user's first click is a genuine decision): the
  interaction becomes visible from the workflow definition alone, with no mutation, and
  `startHumanStep` fires only as the first half of the user's own combined Approve/
  Request-changes operation. The user experience this decision describes is unchanged — they
  still never see a meaningless "Start" button.
- **Date:** 2026-09-21 (activation mechanism corrected 2026-09-22, pass 12 — see D47)
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/29-automatic-workflow-continuation.md`.

## D28: A transition may declare `releasesDependencies: true` to satisfy dependents before its own terminal transition

- **Question:** `evaluateDependencySatisfaction` (`dependency-satisfaction.mjs`) requires the
  dependency's last history entry to resolve to a terminal transition with `outcome:
  'success'` before any dependent is released (confirmed by reading the function directly) —
  there is no earlier release point. In the real dogfooding run this kept `ai-spec-history`
  tasks 02/03 `blocked` for the full duration of task 01's review, even though task 01's
  implementation artifact already existed and downstream tasks could legitimately have started
  against it.
- **Decision:** An additive, per-transition field, `releasesDependencies: true`, may be
  declared on an *internal* (step-to-step) transition. When a task's `workflow_progress`
  history's last entry matches a transition so declared, its dependents are satisfied — even
  though the task's own workflow has not yet reached a terminal transition. The default,
  unmarked behavior for every existing transition (and every existing definition) is
  unchanged: dependents wait for a terminal transition with `outcome: success`, exactly as
  D9 established. Field name/vocabulary chosen for consistency with `outcome`'s existing
  per-transition placement (D9) rather than inventing a step-level or definition-level
  concept.
- **Rationale:** Matches the brief: "Make dependency release point declarative. Do not
  hardcode 'implementation means dependency satisfied'... Design workflow metadata that can
  explicitly state that a transition/milestone releases downstream dependencies." Placing it
  on the transition (not the step) mirrors D9's own reasoning for `outcome` — the release
  point is an event (a specific transition firing), not a static property of a step.
- **Consequences:** `standard-v1.yaml`'s `implementation → review` transition carries
  `releasesDependencies: true` (decided; see the full migration table under the corrected
  D25). A release means a downstream task may **enter the sequential queue's runnable set**
  (D33) — never that it starts concurrently with the releasing task's own continued
  execution; the queue still enforces exactly one active agent execution for the spec. The
  invalidation consequence when a released dependency's later review fails is D31 (resolved).
- **Superseded in substance 2026-09-22 (pass 11) — see D40.** The mechanism above ("last
  history entry matches the release transition") is factually wrong the moment a *second*
  transition happens after the release (e.g. `review → human-verification`) — the dependency
  remains released, but "last entry has the flag" would report it as no longer released. D40
  replaces the satisfaction *mechanism* with a release-epoch model; this entry's core
  decision — an additive, transition-level, declarative release field, chosen for consistency
  with `outcome`'s placement — is unchanged and still governs.
- **Date:** 2026-09-21 (satisfaction mechanism corrected 2026-09-22, pass 11 — see D40)
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/25-workflow-continuation-schema.md`, `tasks/27-dependency-release-and-invalidation.md`.

## D29: `workflow task publish`/Batch Publish own their own commit/push

- **Question:** `publishTask()` validates, calls `setTaskStatus(change, taskId, 'approved')`,
  and returns — confirmed by reading the function end-to-end: no commit/push call anywhere in
  `publish/operation.mjs` or `store.mjs`. In the real dogfooding run this left the Publish
  mutation dirty in the worktree, and the next agent's own `commit-and-push` finalize action
  silently absorbed it into an unrelated implementation commit. Should Publish keep leaving
  its mutation for a later step to accidentally commit?
- **Decision:** No. `publishTask()` (and the equivalent Batch Publish path) becomes:
  validate → mutate → commit → push (only if the resolved `workflow.sourceControl` config
  enables it, per existing per-definition `sourceControl: {enabled, push}` config, unchanged
  in meaning) → return success. The commit message is auto-generated and deterministic —
  `chore(workflow): publish <task-id>` — the user is never asked to type one for this routine
  lifecycle action.
- **Rationale:** Matches the brief's stated principle directly: "a user action that
  independently completes a Git-tracked lifecycle mutation must own the source-control
  finalization of that mutation."
- **Consequences:** Publish's clean-worktree guarantee is preserved (the brief's explicit
  "do not weaken" constraint).
- **Corrected 2026-09-21 (pass 10 — durability was wrong, atomicity was undecided):** the
  original text assumed invoking `commit-and-push` right after `setTaskStatus()` "inherits"
  `finishStep`'s crash/resume semantics. **Grounded fact:** it does not — `finishStep`'s
  durability comes from `operation-record.mjs`'s intent-then-verify pattern (a durable record
  written *before* each mutating stage, reconciled on the next invocation via
  `findInFlightOperationRecord`), not from `CommitAndPushAction` alone; calling that action
  bare, with no durable record wrapping it, leaves Publish exactly as crash-unsafe as before
  if the process dies between `setTaskStatus` and the commit actually landing. **Corrected
  design:** `publishTask()` becomes a durable standalone operation using the *same*
  `.nevo-ai-local/workflow-operations/<change>/<task>/publish/attempt-<n>.json` record
  convention `operation-record.mjs` already defines, reusing its **actually-exported**
  primitives (`operationFilePath`, `loadOperationRecord`, `saveOperationRecord`,
  `findInFlightOperationRecord`), with stages `['validate', 'update-task', 'commit', 'push']`
  mirroring `finish-operation.mjs`'s own `ensureUpdateTask`/`ensureCommit`/`ensurePush`
  intent-then-verify shape. **Batch Publish atomicity, also previously left open, now
  decided:** one dashboard "Publish selected tasks" action is one durable operation record
  spanning the whole selected set (not one record per task) — prevalidate every selected task
  first; only if *all* pass does mutation begin; mutate every selected task's status; one
  deterministic combined commit (e.g. `chore(workflow): publish <task-id-1>, <task-id-2>,
  ...`, bounded/summarized if the list is long) → optional push. If any task fails
  prevalidation, none are published — no partial-batch mutation.
- **Corrected 2026-09-22 (pass 11 — `createOperationRecord` is not an exported primitive;
  the batch-publish path was missing a required segment):** a fresh read of
  `tools/specs/workflow/operation-record.mjs` in full found `createOperationRecord` is a
  **private, non-exported** local function inside `finish-operation.mjs` (line 32,
  `function createOperationRecord(...)`, no `export` keyword) — only `operationFilePath`/
  `loadOperationRecord`/`saveOperationRecord`/`findInFlightOperationRecord` are actually
  exported from `operation-record.mjs`. The prior wording ("reusing `createOperationRecord`…
  directly") documented a primitive as shared that is not. **Corrected:** Publish defines its
  own small, local record-shaping helper (its own `PUBLISH_STAGE_IDS = ['validate',
  'update-task', 'commit', 'push']` and a trivial function building `{operationId, change,
  task, step: 'publish', attempt, status: 'running', operations: PUBLISH_STAGE_IDS.map(...)}`,
  following the exact same shape convention `finish-operation.mjs`'s own private helper uses)
  — it reuses only the genuinely-exported persistence functions
  (`saveOperationRecord`/`loadOperationRecord`/`findInFlightOperationRecord`/
  `operationFilePath`), never a cross-file import of `createOperationRecord` itself. Separately,
  `operationFilePath(repoRoot, changeSlug, taskId, stepName, attempt)`'s real signature always
  produces a **four-segment** path — `<change>/<taskId>/<stepName>/attempt-<n>.json` — so the
  originally-specified Batch Publish path,
  `.nevo-ai-local/workflow-operations/<change>/_batch-publish/attempt-<n>.json` (three
  segments, missing the step-name level), does not match the real convention and would not
  round-trip through `operationFilePath`/`findInFlightOperationRecord` correctly. Corrected to
  `.nevo-ai-local/workflow-operations/<change>/_batch-publish/publish/attempt-<n>.json` —
  pseudo-`taskId` `_batch-publish`, real step name `publish` — calling `operationFilePath`
  exactly as a single-task publish does, just with a reserved task-id.
- **Date:** 2026-09-21 (durability and batch atomicity corrected 2026-09-21, pass 10;
  operation-record export and batch path corrected 2026-09-22, pass 11)
- **Affected artifacts:** `areas/user-mutation-source-control-ownership.md`,
  `tasks/31-user-mutation-source-control-finalization.md`.

## D30: Explicit three-way source-control ownership taxonomy

- **Question:** Finding 11 (D29) happened because no documentation distinguished a standalone
  user mutation (which must finalize its own Git state) from a technical activation (which may
  ride along with the attempt it belongs to) from a completed lifecycle mutation (which
  already owns its own finalize). Without naming this boundary, a future dashboard action
  could reproduce the same mistake.
- **Decision:** Document three explicit categories (extending
  `docs/development/agent-workflow-protocol.md`'s existing ownership-boundary section, per D3's
  precedent — no new doc file): **(1) standalone user-originated Git-tracked mutation**
  (e.g. Publish) — must finalize its own commit/push, per D29; **(2) technical activation
  that is part of an execution attempt** (e.g. `workflow step start`, human-step
  auto-activation, D27) — may remain part of that attempt, finalized by its own
  `workflow step finish`/`submitHumanStepResult`; **(3) completed lifecycle mutation**
  (e.g. `submitHumanStepResult`, `finishStep`) — already owns its deterministic
  finalize/commit/push, unchanged.
- **Rationale:** Matches the brief's own worked examples exactly; makes the boundary
  reviewable rather than re-derived ad hoc for each new action.
- **Consequences:** Any future user-facing dashboard action that mutates `change.yaml`/
  `workflow_progress` must be classified against these three categories before being built —
  a documentation-level guardrail, not a new enforced runtime check.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/user-mutation-source-control-ownership.md`,
  `tasks/31-user-mutation-source-control-finalization.md`.

## D31: Dependency invalidation forms an automatic remediation group, fixed and re-reviewed together, with cross-task-aware review

- **Question:** OQ-A, resolved. When a dependency task (e.g. t1) whose declarative release
  (D28) already let downstream tasks (e.g. t2, t3) start, later fails its own review and
  returns to implementation, what is the deterministic consequence — for t1's own fix cycle,
  for the already-started downstream tasks, and for how the fix gets reviewed?
- **Decision (owner's own direction, not option (a)/(b)/(c)):**
  1. **Automatic remediation-group derivation, including already-terminal consumers
     (corrected 2026-09-21, pass 10).** The system — never the owner by hand — computes the
     remediation group: t1 plus **every** downstream task that actually consumed t1's
     premature `releasesDependencies` release, **regardless of that task's current state**
     (`active`, `waiting`, `completed`, or already `terminal`) — the original wording
     ("has not yet reached its own terminal transition") was itself unsafe: a downstream task
     that already reached `verified` while built against the invalidated release is not
     retroactively correct merely because it finished. This is derived from existing
     `workflow_progress` dependency-release history (D28), the same data
     `dependency-satisfaction.mjs` already tracks — no new manual bookkeeping is introduced
     for the owner to maintain. **A terminal consumer is never reopened or reverted** —
     reopening a completed deterministic workflow is not a supported engine operation today
     and is not designed by this pass; instead, a terminal consumer is flagged in the group
     with a `suspensions[]` entry (D37) whose meaning is advisory/blocking-for-finalization
     ("this task's result requires revalidation"), not an enforceable next-step block (it has
     no next step). If the combined review (task 30) determines a terminal consumer's actual
     result is wrong, that is itself a structured `NEEDS_CLARIFICATION`/owner-decision
     finding — reopening mechanics are explicitly deferred to a future decision if/when this
     occurs in practice, not solved speculatively here.
  2. **Suspension, not rollback.** Every task in the remediation group is suspended from
     starting its own *next* step (same forward-only, non-destructive shape as the original
     option (a)) until the group's remediation completes — no already-completed work in any
     group member is reverted.
  3. **Grouped fix.** The owner (or the dashboard, surfacing the group) drives implementation
     fixes across the group's affected tasks together — e.g. t1 and t3 both get their
     implementation-fix attempts before either is resubmitted — reusing
     `areas/deterministic-sequential-queue.md`'s scheduler to run the group's fix attempts,
     not a separate mechanism.
  4. **One combined review pass, cross-task-aware.** The group's fixes are submitted into a
     single review pass over the whole remediation group, not independent per-task reviews
     each auto-continuing on their own. This review must check cross-task consistency: if
     t1's fix changes something a group member depends on, and that dependency is not
     satisfied by the member's own current implementation, the review must flag that member
     for a required fix — even if the member itself was not directly touched in this fix
     round (e.g. t2, if t2 also depends on t1 but wasn't part of the original fix set) — with
     an explicit, stated reason tying the flagged adjustment back to t1's specific change.
     Silently passing a group member whose assumptions no longer hold is not acceptable.
  5. **Reuse the existing cross-task review design, not a new one.** The legacy
     `implementation-review` mechanism (`references/review-policy.md` § "Multi-task
     implementation review") already solves exactly this shape for the legacy lifecycle:
     file-overlap detection plus bounded semantic-integration pairs
     (`selectSemanticIntegrationPairs`, `detectBatchIntegrationFindings`) across a scope of
     tasks, producing a structured finding only for a real inconsistency, never a synthetic
     one. That code is legacy-lifecycle-specific and is not reused directly (it is keyed to
     legacy `task.status` and `task-review`'s own flow), but its *design* — deterministic
     scope resolution, per-task review first, then a bounded semantic-integration pass over
     related pairs, one aggregate verdict — is the pattern
     `dependency-invalidation-remediation-review` (task 30) adapts for the deterministic
     `workflow_progress` engine, rather than inventing an unrelated design from scratch.
  6. **Group can grow during its own review — and that growth must be durable (corrected
     2026-09-21, pass 10; see D36).** Discovering, during the combined review, that an
     additional downstream task needs a fix is itself a real, structured finding the review
     surfaces (extending the remediation group), never something silently absorbed or
     dropped. This creates a real tension the original text left unresolved: a group "purely
     derived from `workflow_progress` history" cannot also be "extended by a semantic review
     finding" — an extension is not itself re-derivable from history alone. D36 resolves this
     with a durable local orchestration record for the group, independent of but consistent
     with `workflow_progress`.
- **Rationale:** Matches the owner's stated real workflow directly: fixes to a failed
  dependency and its consumers happen together, not as isolated per-task auto-continuations
  that would miss exactly the cross-task adjustment the owner described (t1 changes → t2
  needs adjusting even though t2 wasn't itself broken). Reusing `implementation-review`'s
  proven two-pass cross-task design avoids re-deriving a review algorithm this repository
  already has working, tested code for, in spirit if not in literal reuse.
- **Consequences:** `areas/dependency-release-and-invalidation.md`'s task (27) gains the
  remediation-group derivation and suspension signal (including terminal consumers); a new
  task, `dependency-invalidation-remediation-review` (task 30), owns the combined,
  cross-task-aware review pass, depending on task 27 (the group signal) and task 28 (running
  the group's fix attempts through the sequential queue, never concurrently, per D33).
- **Corrected 2026-09-22 (pass 11 — trigger and membership evidence, not step-graph position
  or guesswork):** two remaining gaps. First, "later fails its own review and returns to
  implementation" and any wording keyed on the workflow transitioning "backward" to an
  "earlier step" is removed — workflow steps form a graph; there is no generic "earlier"
  step, and D40 already replaces "the last history entry" with an explicit, declarative
  **invalidation** trigger (`invalidatesDependencyRelease: true`, a transition property,
  exactly symmetric with `releasesDependencies`). A remediation group is derived when — and
  only when — a transition so declared actually fires; never inferred from step-graph
  position. Second, "every downstream task that actually consumed t1's premature release" is
  no longer derived by scanning `workflow_progress` for tasks that merely "became active
  while the release was in effect" — D43 found this cannot be reconstructed reliably across
  multiple release/invalidate/re-release cycles, since `workflow_progress.history` does not
  record consumption provenance. Membership is instead read directly from the durable
  dependency-consumption records D43 introduces (`{consumingTaskId, consumingAttempt,
  dependencyTaskId, releaseEpoch}`, written at admission time) — every task whose recorded
  `releaseEpoch` matches the now-invalidated epoch is a group member, evidence-based, never
  guessed from current state or timestamps.
- **Date:** 2026-09-21 (terminal-consumer inclusion and durability corrected 2026-09-21,
  pass 10; invalidation trigger and membership evidence corrected 2026-09-22, pass 11 — see
  D40, D43)
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `areas/deterministic-sequential-queue.md`, `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/30-dependency-invalidation-remediation-review.md`.

## D32: Batch task selection is a checkbox picker pre-selected with ready tasks, not named selection "modes"; cross-selection dependency gaps warn, never hard-block

- **Question:** OQ-B, resolved. What does "task-selection mode" actually mean in real usage,
  and what should the default behavior be?
- **Decision (owner's own direction, replacing the original three-named-modes framing):**
  There is one selection mechanism, not three named modes: a checkbox-based task picker,
  pre-selected with whichever tasks are currently ready (the previous "currently-ready"
  framing survives only as this picker's *default checked state*, not as a separate API
  concept), which the owner can freely adjust — check more (including not-yet-ready tasks,
  covering the old "named-subset"/"all-approved-reachable" cases as unconstrained manual
  selection, not distinct modes) or fewer. The one behavior the UI must enforce: if the
  current selection includes a task blocked by a dependency that is itself **not** in the
  selection and not yet satisfied, show at least a warning — never silently start it (it
  can't succeed anyway) and never hard-block the selection outright (the owner may be
  intentionally staging a multi-step batch across two runs). A concrete bounded concurrency
  limit is still required internally (the engine must not start unboundedly many concurrent
  sessions even from a fully-manual selection) — defaulted to a small, configurable value
  during implementation as an ordinary implementation detail, not gated further by this
  decision.
- **Rationale:** Matches the owner's actual described workflow (pick several, or all, or
  one, via checkboxes) rather than an abstract enum of selection strategies that doesn't map
  to how the picker is actually used. Warn-not-block on a selected-but-unsatisfied dependency
  respects that the owner may deliberately be running a partial batch across multiple passes.
- **Consequences:** `areas/deterministic-sequential-queue.md`'s three-named-"selection
  modes" framing is replaced by this single checkbox-picker model;
  `deterministic-sequential-queue` (task 28) and `dashboard-orchestration-wiring` (task 32)
  are corrected accordingly.
- **SUPERSEDED 2026-09-21 (pass 10) — corrected in full by D33, not amended in place, because
  the whole premise was wrong, not just a detail.** This decision's checkbox-picker selection
  UX and warn-not-block behavior **stand, unchanged**. But "a concrete bounded concurrency
  limit is still required internally… defaulted to a small, configurable value" is **retracted
  outright**: this pass wrongly introduced *any* notion of concurrent agent execution within
  one specification. Nevo's deterministic workflow model is a **single-active-execution**
  invariant per specification — not "bounded concurrency," not "start two independently-ready
  tasks," not "parallel agent sessions." A batch is a **queue**: selected tasks execute one at
  a time, in a deterministically-ordered sequence, never concurrently. See D33 for the full,
  corrected model — every "concurrency limit"/"bounded concurrency"/"parallel starts" phrase
  anywhere in this spec's areas/tasks is removed, not merely bounded to a small number.
- **Date:** 2026-09-21 (selection UX decided 2026-09-21; concurrency assumption retracted and
  replaced by D33, 2026-09-21, pass 10)
- **Affected artifacts:** `areas/deterministic-sequential-queue.md`,
  `tasks/28-deterministic-sequential-queue.md`, `tasks/32-dashboard-orchestration-wiring.md`.

## D33: Single active agent execution per specification — batch means a sequential queue, never concurrency

- **Question:** Tasks 24–33 (D21–D32) incorrectly introduced concurrent execution of
  multiple tasks belonging to the same specification/change — a "concurrency limit," "start
  two independently-ready tasks," and bounded-parallelism language throughout
  `deterministic-sequential-queue`. Is this the intended model?
- **Decision:** No — corrected as a deliberate architecture invariant, not merely an initial
  implementation limitation: **for one specification, at most one agent-owned execution may
  be running at a time**, covering every current and future agent-owned step kind
  (implementation, review, refinement, hardening, discovery, anything else). A "batch" means:
  the user selects several tasks → Nevo creates a deterministic **queue** → executes them
  **one by one** → recomputes readiness/eligibility after every transition → selects the
  next runnable execution → repeats until the queue is exhausted, a real owner action is
  required, execution fails/blocks, or remediation requires intervention. It never means two
  task sessions running concurrently. A selected-but-not-yet-ready task stays queued and
  becomes eligible automatically once its dependencies are satisfied (including via a
  `releasesDependencies` milestone, D28) — no re-selection needed.
- **Rationale:** Stated directly as a fundamental correction, not a preference: Nevo's
  deterministic workflow model does not support parallel execution of tasks belonging to the
  same specification. Sequential execution also sidesteps an entire category of complexity
  (per-task Git worktrees, merge strategy, parallel-branch integration, workspace isolation)
  that concurrent execution would have required and that this change does not need — none of
  it is introduced.
- **Consequences:** Every "concurrency limit"/"bounded concurrency"/"parallel agent
  sessions"/"start two independently-ready tasks" phrase is removed from D32,
  `areas/deterministic-sequential-queue.md`, `tasks/28-deterministic-sequential-queue.md`,
  `tasks/32-dashboard-orchestration-wiring.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`,
  and every other affected artifact — replaced by the queue model above.
  `automatic-workflow-continuation`'s (task 29) own same-task continuation (D25) and the
  cross-task queue (task 28) are **the same scheduler**, not two competing paths — a
  same-task automatic continuation becomes eligible exactly like any other queued item and
  goes through the identical "one active execution" gate (see D34 for how the scheduler picks
  among several simultaneously-eligible items). No per-task worktrees, merge orchestration,
  or workspace isolation of any kind is required or introduced by this change.
- **Date:** 2026-09-21
- **Affected artifacts:** `overview.md`, `owner-decisions.md` (D32, superseded above),
  `areas/deterministic-sequential-queue.md`,
  `areas/workflow-continuation-and-session-handover.md`,
  `tasks/28-deterministic-sequential-queue.md`, `tasks/29-automatic-workflow-continuation.md`,
  `tasks/32-dashboard-orchestration-wiring.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D34: Declarative scheduling priority resolves ordering among several simultaneously-runnable items — no step-name coupling

- **Question:** With sequential (never concurrent) execution, the queue can have several
  eligible items at once (e.g. `T1 review`, `T2 implementation`, `T3 implementation`, all
  runnable after `T1`'s implementation releases `T2`/`T3`). The scheduler needs a
  deterministic ordering policy without hardcoding `if step === 'implementation'`/
  `if step === 'review'`. What expresses this declaratively?
- **Grounded fact (2026-09-21):** no existing field in `.nevo-ai/workflows/*.yaml` or
  `definitions/schema.mjs` expresses relative step ordering/priority (grep confirmed none).
  `change.yaml`'s per-task `order` field **is** already used at runtime for scheduling —
  `tools/specs/context.mjs`'s legacy `getNext()` sorts ready candidates by `change.priority`
  then ascending `task.order ?? 999` — but this is a cross-*task* ordering signal (which task
  to work on first), not a cross-*step-class* one (finish all implementation-class work
  before starting review-class work across several tasks), so it does not by itself express
  what's needed here, though its ascending-sort convention is reused below.
- **Decision:** An additive, optional per-step field, `schedulingPriority: <integer>`,
  ascending (lower runs first — the same convention `task.order` already uses), default `0`
  when absent (so an unspecified workflow's steps are all equal-priority and the queue falls
  back to FIFO/`task.order` tie-breaking, never an arbitrary bias). Tie-break order among
  equal `schedulingPriority` values: ascending `task.order`, then the order the item became
  eligible (FIFO) — reusing the existing `task.order` field as the tie-break, per the "reuse
  a simpler existing mechanism if it can express this cleanly" instruction, rather than
  inventing a second ordering axis for ties. `standard-v1.yaml`: `implementation` keeps the
  default (`0`, unwritten); `review` sets `schedulingPriority: 10` — so, exactly matching the
  desired worked example, once `T1`'s implementation releases `T2`/`T3`, the scheduler
  prefers remaining `schedulingPriority: 0` implementation-class work (`T2`, `T3`) over `T1
  review` (`10`), then works through the review wave once no lower-priority item remains
  eligible. No application code compares a step id/name anywhere in this mechanism — the
  scheduler only ever reads `schedulingPriority`/`task.order` values.
- **Rationale:** Matches the requirement exactly: workflow definitions express relative
  priority without application code knowing semantic step names; reuses `task.order` as the
  tie-break rather than adding a second, redundant ordering field for that purpose.
- **Consequences:** `sequential-task-queue` (task 28) implements this comparison as a pure
  sort — `(schedulingPriority, task.order, eligibleAt)` ascending, first item wins — with no
  step-name branch anywhere.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/deterministic-sequential-queue.md`,
  `tasks/25-workflow-continuation-schema.md`, `tasks/28-deterministic-sequential-queue.md`,
  `.nevo-ai/workflows/standard-v1.yaml`.

## D35: Server-side, idempotent continuation trigger — not a React page callback

- **Question:** The prior draft implicitly made `agent-session-page.tsx`'s `onTurnCompleted`
  callback responsible for triggering continuation — which only fires while that specific
  browser tab is open and only ever re-fetches client-side state (confirmed: its one observed
  effect is refreshing `availableActions`, not any server-side write). Automatic continuation
  must not depend on a specific page being open. What is the actual authoritative server-side
  boundary, and how does it stay correct after a dashboard reload, server restart, or missed
  UI callback?
- **Grounded fact (2026-09-21):** `AgentTurnRuntime.#finish()`
  (`tools/dashboard/server/ai/sessions/turns/runtime.mjs`) is the one place a turn reaches a
  terminal state (`turn.completed`/`turn.failed`) — entirely server-side, independent of any
  connected browser client; it already runs from `#run`/timeout/cancel paths regardless of UI
  presence. Separately, `turn-recovery.mjs`'s `reconcileOrphanedTurns()` already establishes
  the precedent for idempotent, boot-adjacent reconciliation of state an ungraceful restart
  may have left inconsistent (finalizing any `activeTurn` a crashed server never terminated),
  currently invoked lazily on the first inbound HTTP request via `ensureReconciled()`
  (`tools/dashboard/server/ai/routes.mjs`) rather than a true background boot task. The
  existing `specs-changed` filesystem watcher (`tools/dashboard/server/specs/watcher.mjs`)
  only pushes a change notification to connected SSE clients for them to re-fetch — no
  server-side handler consumes it to recompute or persist anything today.
- **Decision:** Continuation's authoritative trigger is server-side, hooked to
  `AgentTurnRuntime`'s own `turn.completed`/`turn.failed` event — not a UI callback. On that
  event, the new orchestration layer (task 29) resolves the task's authoritative
  `workflow_progress` position, checks the matched transition's `continuation` field, and — if
  `auto` — enqueues the destination into the sequential queue (task 28) rather than executing
  it inline. **Idempotent reconciliation**, mirroring `reconcileOrphanedTurns()`'s own
  established pattern, additionally runs on the same `ensureReconciled()`-style lazy
  first-request hook: it inspects every in-progress spec's authoritative workflow position
  against the queue's own durable state and enqueues any `continuation: auto` destination the
  real-time event path might have missed (a missed UI callback is irrelevant either way, since
  the UI was never the trigger; this reconciliation instead covers a server crash/restart
  between the turn event firing and the queue recording it). The dashboard UI **observes**
  queue/orchestration state (via the existing DTO/SSE mechanisms) — it is never required to
  drive correctness by staying open or invoking anything itself.
- **Rationale:** Matches the requirement directly: continuation must not depend on a specific
  React page being open; reuses this repository's own existing reconciliation precedent
  rather than inventing an unrelated one.
- **Consequences:** `automatic-workflow-continuation` (task 29) moves its real ownership from
  `agent-session-page.tsx`/`agent-session-chat-surface.tsx` (client-side, wrong) to a new
  server-side module hooked into `AgentTurnRuntime`'s lifecycle events plus the existing
  `ensureReconciled()` boot-adjacent hook — the client files are corrected only to stop
  driving continuation themselves (they may still display state), not to gain new logic.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/29-automatic-workflow-continuation.md`.

## D36: Durable local orchestration record for a remediation group — distinct from `workflow_progress`

- **Question:** D31 says a remediation group is "purely derived from `workflow_progress`
  history" and, separately, that cross-task review "may discover a new member and add it to
  the group." Both cannot be true of a purely-derived value — an extension based on a
  semantic review finding is not itself re-derivable from history alone. How does group
  membership stay consistent and survive reload/restart once it can be extended?
- **Decision:** Introduce a durable local orchestration record for each remediation group,
  using the existing `.nevo-ai-local/` local-runtime convention (git-ignored, atomic
  temp-file-then-rename writes, same family as `.nevo-ai-local/workflow-operations/**`):
  `.nevo-ai-local/remediation-groups/<change>/<remediationId>.json`, shape at minimum
  `{remediationId, rootTaskId, causeAttempt: {step, attempt}, members: string[],
  discoveredMembers: string[], state: 'open'|'fixing'|'reviewing'|'resolved'}`. This record is
  **orchestration state, not event sourcing** — `workflow_progress` remains the sole
  authoritative record of each task's actual workflow history; the remediation record only
  tracks which tasks are currently considered part of a given remediation effort and its
  status. `dependency-release-and-invalidation` (task 27) owns creating/reading the initial
  derivation into this record; `dependency-invalidation-remediation-review` (task 30) is the
  one caller allowed to extend `discoveredMembers`. The owner never maintains this record by
  hand.
- **Rationale:** Resolves the internal contradiction directly: a value that can be extended
  by a review finding needs its own durable state, not a claim of pure derivability from a
  different, unrelated authoritative source.
- **Consequences:** Group durability survives dashboard reload/server restart — the
  remediation flow does not need to re-derive (and potentially re-compute differently) the
  group from scratch after every restart.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `areas/dependency-invalidation-remediation-review.md`,
  `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/30-dependency-invalidation-remediation-review.md`.

## D37: `blockedBy` stays a plain task-id array; remediation/invalidation state gets its own `suspensions` field

- **Question:** The dashboard's existing `blockedBy: string[]` contract (task ids, an
  ordinary dependency signal) was at risk of being silently overloaded into a mixed
  object array (`{taskId, reason, groupId}`) for remediation/invalidation state — a DTO
  shape change every existing consumer (`status-board.tsx`, `task-dialog.tsx`, both calling
  `.length`/`.join()` directly on it) would break without a full, deliberate migration.
- **Grounded fact (2026-09-21):** `blockedBy` is `string[]` consistently across
  `task-projection.mjs`, `actions.mjs`, and the frontend `types.ts`
  (`SpecificationTask`/`TaskStatusSummary`/`SpecificationTaskActionGate`); three real UI call
  sites call `.length`/`.join(', ')` on it directly.
- **Decision:** `blockedBy` keeps its existing `string[]` shape and meaning unchanged —
  ordinary unsatisfied-dependency task ids only. Remediation/invalidation state (D31's
  suspension entries, including the terminal-consumer advisory case) lives in a new, separate
  field, **`suspensions: [{taskId, reason, groupId?}]`**, additive to the existing DTO —
  never merged into `blockedBy`. UI/projection tasks that need to render suspension state add
  a new, explicit rendering path for `suspensions`, never repurpose the existing `blockedBy`
  rendering.
- **Rationale:** Avoids an unplanned breaking DTO migration for three existing call sites;
  keeps the two concepts (ordinary dependency block vs. remediation/invalidation suspension)
  explicit and independently evolvable.
- **Consequences:** `TaskProjection`, the dashboard action DTO, and the frontend `types.ts`
  each gain `suspensions?: {taskId, reason, groupId?}[]` alongside the unchanged `blockedBy`.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/32-dashboard-orchestration-wiring.md`.

## D38: Workflow-core stays free of dashboard/AI-runtime imports — the sequential queue is pure domain logic, orchestration is a separate application layer

- **Question:** The sequential queue (correcting `deterministic-sequential-queue`) must not
  make `tools/specs/workflow/**` (core, provider-neutral engine) depend on
  `tools/dashboard/server/ai/**` (AI/session runtime) — confirm the existing direction and
  settle the queue's own placement.
- **Grounded fact (2026-09-21):** no file under `tools/specs/workflow/**` imports anything
  from `tools/dashboard/**` today (grep confirmed); the reverse is the normal, established
  direction — `tools/dashboard/server/specs/actions.mjs`,
  `tools/dashboard/server/specs/human-step-transport.mjs`, and others freely import
  `tools/specs/workflow/**`'s exports. No `tools/specs/workflow/batch/` directory exists yet
  (this spec's own tasks are still unimplemented text) — `tools/specs/batch/` is the
  unrelated, pre-existing legacy batch feature.
- **Decision:** Split ownership explicitly along the existing, correct dependency direction:
  **`tools/specs/workflow/queue/**`** (new, pure domain module, core/provider-neutral) owns
  only the queue/readiness/scheduling *plan* — given selected+queued task ids, each task's
  current `TaskProjection`, and each candidate transition's `schedulingPriority`/
  `continuation`, it computes the ordered runnable list and its own durable queue-membership
  state (local FS I/O in the same family as `operation-record.mjs`/`human-verification-
  store.mjs`, already precedented within this same directory tree — "pure" means no AI/
  session/dashboard awareness, not "no I/O at all"). It has zero knowledge of AI sessions,
  execution policy, or whether an execution is currently "active" in the dashboard's own
  runtime sense. **A new dashboard-side application/orchestration module**
  (`tools/dashboard/server/ai/orchestration/**`) consumes the queue's plan, tracks whether an
  agent execution is currently active for the spec (reading existing session/binding state),
  and — only when free — asks the queue "what's next," then creates/reuses a session (D26) or
  calls `startHumanStep` (D27) accordingly. This module is also where D35's
  `AgentTurnRuntime` event hook and reconciliation live.
- **Rationale:** Matches the requirement directly and follows the repository's own,
  already-correct existing direction rather than inventing a new one — dashboard depends on
  workflow core, never the reverse.
- **Consequences:** `deterministic-sequential-queue` (task 28) owns
  `tools/specs/workflow/queue/**` only; `automatic-workflow-continuation` (task 29) owns
  `tools/dashboard/server/ai/orchestration/**`. Neither task's `allowed_paths` overlaps the
  other's core-vs-application boundary.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/deterministic-sequential-queue.md`,
  `areas/workflow-continuation-and-session-handover.md`,
  `tasks/28-deterministic-sequential-queue.md`, `tasks/29-automatic-workflow-continuation.md`.

## D39: `schedulingPriority`/`execution`/`continuation`/`releasesDependencies` schema — final consolidated shape

- **Question:** With D25/D26/D28/D34 each adding transition/step-level schema, record the
  final, consolidated shape once so `workflow-continuation-schema` (task 25) implements a
  single coherent extension rather than four uncoordinated ones.
- **Decision:** Per internal (non-terminal) transition, all additive/optional:
  `continuation: auto | owner-action` (default `owner-action`), `releasesDependencies: true`
  (default absent/false), `execution: {session: reuse | fresh, role: <string>}` (meaningful
  only when the transition's `to` targets an `executor: agent` step — omitted for a
  human-owned or terminal destination). Per step, additive/optional: `schedulingPriority:
  <integer>` (default `0`). `normalizeWorkflowDefinition()` preserves all four verbatim on
  its normalized output, following the exact precedent D6/D9 already established for
  `executor`/`action`/`outcome`.
- **Rationale:** One consolidated schema task avoids four separately-reasoned, potentially
  inconsistent additions to the same normalization function.
- **Consequences:** `tasks/25-workflow-continuation-schema.md` implements and tests all four
  fields together, migrating `standard-v1.yaml`'s every internal transition per the tables
  recorded under the corrected D25/D26/D28/D34.
- **Corrected 2026-09-22 (pass 11 — one field added):** `invalidatesDependencyRelease: true`
  (D40) joins this same consolidated list, on the same terms as `releasesDependencies`
  (additive, internal-transition-only, mutually consistent — a transition may never declare
  both).
- **Date:** 2026-09-21 (extended 2026-09-22, pass 11 — see D40)
- **Affected artifacts:** `tasks/25-workflow-continuation-schema.md`,
  `.nevo-ai/workflows/standard-v1.yaml`, `tools/specs/workflow/definitions/schema.mjs`.

## D40: Dependency release is an epoch that remains valid until an explicit, declarative invalidation fires

- **Question:** `evaluateDependencySatisfaction`'s release check (D28) only reads
  `history.at(-1)` — the *last* history entry. Confirmed by reading the function directly:
  after `implementation → review` releases dependents, the very next transition
  (`review → human-verification`) becomes the new "last entry," which carries no
  `releasesDependencies` flag of its own — under the as-built logic the release would appear
  to have lapsed even though nothing invalidated it. How should a release remain effective
  across further, non-invalidating transitions, and what explicitly ends it?
- **Decision:** A release is a **release epoch**, not a point-in-time flag on the latest
  entry. `evaluateDependencySatisfaction`'s release path scans a task's **full**
  `workflow_progress.history`, not just the last entry: it finds the *last* history entry
  whose matched transition declares `releasesDependencies: true` (call its index/attempt the
  release epoch), then checks whether any **later** history entry's matched transition
  declares the new, symmetric field **`invalidatesDependencyRelease: true`**. If no such
  later entry exists, the release remains in effect regardless of how many non-invalidating
  transitions happened in between. If one does exist, the release from that epoch is no
  longer in effect (a later `releasesDependencies` transition, if any, starts a new epoch).
  No wording or logic anywhere in this mechanism references a transition going "backward" or
  to an "earlier step" — workflow steps form a graph, not a line, and there is no generic
  "earlier" step; the only two facts that matter are which declared transitions actually
  fired and in what history order. `standard-v1.yaml` declares both a release point and its
  invalidation points explicitly (task 25's schema): `implementation → review`
  (`releasesDependencies: true`, unchanged); `review`'s `value: fail, to: implementation`
  (`invalidatesDependencyRelease: true` — a failed review means the released implementation
  needs rework); `human-verification`'s `value: fail, to: implementation` (`action.label:
  "Request changes"`, `invalidatesDependencyRelease: true` — same reasoning, the human found
  a problem with what was released). Neither field may be declared on the same transition as
  the other, and both remain legal only on internal transitions (D25/D28's existing
  constraint, unchanged).
- **Rationale:** Matches the brief precisely: model release as a milestone/epoch that remains
  effective until explicitly invalidated, not a per-entry flag; declare both release and
  invalidation points explicitly in the workflow definition; never infer either from
  step-graph position.
- **Consequences:** `dependency-satisfaction.mjs`'s release-checking logic changes from an
  `O(1)` last-entry read to an `O(history length)` scan — history is small and bounded per
  task, so this has no real performance concern. The release epoch identifier (`{step,
  attempt}` of the releasing history entry) is the same identifier D43's dependency-
  consumption provenance records reference, so remediation-group membership (D31, corrected)
  can be resolved by exact epoch match rather than guessed from current task state.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/25-workflow-continuation-schema.md`, `tasks/27-dependency-release-and-invalidation.md`,
  `.nevo-ai/workflows/standard-v1.yaml`.

## D41: One spec-level admission gate for every execution path; atomic via an in-process serialized claim

- **Question:** The single-active-execution invariant (D33) must hold across manual single
  Start, batch Start, automatic continuation, and remediation execution — but `startStep()`
  (and equivalent entry points) can still call session-creation directly, bypassing the
  sequential queue entirely. Even if every path *did* go through the queue, the queue's
  `nextRunnable: one item` answer is a read, not a claim — two simultaneous requests could
  both read "spec is free" and both create a session before either write is visible to the
  other. How is the invariant actually enforced, atomically, across all four paths?
- **Grounded fact (2026-09-22):** `AgentTurnRuntime` (`tools/dashboard/server/ai/sessions/
  turns/runtime.mjs`) already solves an analogous problem for a different key: `startTurn()`
  calls `await this.#acquireStartLock(key)` (`key` = session id) before touching any shared
  state — `#acquireStartLock` is a promise-chain mutex (`#startQueueBySession: Map<key,
  Promise>`) that serializes concurrent callers for the same key with no external lock file
  or database, because the whole dashboard server is a single Node process. This is a real,
  proven, already-in-production pattern for exactly this class of problem, just keyed by
  session id instead of spec id.
- **Decision:** One spec-level admission function —
  `tools/dashboard/server/ai/orchestration/admission.mjs`'s `admitAgentExecution(specId,
  candidate)` — is the **only** path capable of resulting in a new agent session or
  `startHumanStep` call for deterministic workflow execution. It reuses the exact
  `#acquireStartLock`-style promise-chain mutex pattern, keyed by `specId`: acquire the
  spec's lock, check whether an agent execution is already active for that spec (reading real
  session/binding state), and if not, atomically mark the spec occupied (in-process, for the
  duration of the check-and-claim) before returning "admitted" — the check and the claim
  happen inside the same held lock, so two simultaneous callers can never both observe "free."
  All four paths funnel through it: **manual single Start** = enqueue one item, then call
  `admitAgentExecution`; **batch Start** = enqueue several items, then call `admitAgentExecution` once
  (it only ever admits one); **automatic continuation** (D42) = enqueue the eligible
  destination, then call `admitAgentExecution`; **remediation execution** = enqueue the group's
  task-id set as an ordinary queue selection (D31 unchanged), then call `admitAgentExecution`.
  `startStep()` and every other UI entry point are corrected to call this gate — never
  `createSession`/`startHumanStep` directly for deterministic execution.
- **Rationale:** Matches the requirement directly: one gate, no second path, and race-safety
  solved by reusing this repository's own proven serialization pattern rather than inventing
  file locks, database transactions, or (explicitly ruled out) per-task worktrees or a
  concurrency limit.
- **Consequences:** `automatic-workflow-continuation` (task 29) owns `admission.mjs`.
  `dashboard-orchestration-wiring` (task 32)'s `startStep()` calls this gate exclusively — its
  own direct `createSession.create(...)` call for the deterministic execution path is removed
  (task 26's execution-policy-selection UI still precedes it, unchanged, but the actual
  session creation now happens only inside `admitAgentExecution`'s admitted branch).
- **Corrected 2026-09-22 (pass 12 — renamed, atomicity strengthened, human path removed —
  see D49):** "may result in a new agent session or `startHumanStep` call" was itself wrong —
  a human decision never occupies this slot and is never gated by this function (contradicted
  task 29's own, correct text; resolved by D49's explicit two-branch dispatch). The name
  itself is now `admitAgentExecution` (was `admitExecution`), and its claim lifecycle is
  strengthened to hold through to durable visibility with rollback on failure — see D49 for
  the full, corrected contract; this entry's core decision (one gate, all agent-owned paths,
  reusing `#acquireStartLock`'s proven pattern) stands.
- **Date:** 2026-09-22 (renamed and lifecycle strengthened 2026-09-22, pass 12 — see D49)
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `areas/deterministic-sequential-queue.md`, `tasks/29-automatic-workflow-continuation.md`,
  `tasks/32-dashboard-orchestration-wiring.md`.

## D42: Continuation reconciliation is one shared operation, triggered from three real server-side points — not a fictitious global turn event

- **Question:** The prior design assumed `AgentTurnRuntime` exposes a global
  `turn.completed`/`turn.failed` event any outside module could subscribe to. It also only
  addressed agent-owned continuation, not `submitHumanStepResult`'s own
  `continuation: auto` case (e.g. human "Request changes" → implementation must be enqueued
  immediately). What does the real API surface support, and where does reconciliation
  actually need to be triggered from?
- **Grounded fact (2026-09-22):** `AgentTurnRuntime.#eventStream.emit(state.turnId, type,
  data)` (`runtime.mjs`) emits **keyed by `turnId`**, for streaming to whichever client calls
  `subscribeToSession`/an equivalent per-turn subscription — there is **no** global "any turn,
  anywhere, reached terminal" bus. `startTurn()` itself fires its work via `queueMicrotask(()
  => this.#run(...))` and returns immediately once the turn is established — the caller
  (`AgentSessionService`, `service.mjs`) does not `await` full completion, so
  `service.mjs`'s own call site is not a valid "runs after every turn" hook either, as
  written today. `AgentSessionService` (`service.mjs`) is the one module that already
  centralizes every `startTurn()` call across the whole server (one shared `turnRuntime`
  instance, held by one `AgentSessionService` instance) — it is the real, existing ownership
  point the brief's fallback names. Separately, `tools/dashboard/server/specs/
  human-step-transport.mjs`'s handler already `await`s `submitHumanStepResult(...)`
  synchronously and returns its result (`finishResult`) — a clean, already-existing
  server-side point to call reconciliation right after a human decision lands.
- **Decision:** One shared function, `reconcileWorkflowPosition(change, task)`
  (`tools/dashboard/server/ai/orchestration/**`), is the single place that: resolves the
  task's authoritative `workflow_progress` position, finds the matched transition, and — if
  `continuation: auto` — enqueues the destination (D28/D40) via the sequential queue, then
  calls `admitAgentExecution` (D41). It is invoked from exactly three real points, not a fictitious
  one: (1) **`AgentSessionService`**, corrected to attach its own internal listener via the
  existing per-turn `subscribeToSession`-style mechanism at the moment it starts a turn for a
  session bound to a deterministic task, firing `reconcileWorkflowPosition` when that specific
  turn reaches terminal; (2) **`human-step-transport.mjs`**'s handler, immediately after
  `submitHumanStepResult` resolves successfully; (3) the existing `ensureReconciled()`-style
  lazy first-request hook (`tools/dashboard/server/ai/routes.mjs`), extended to also run
  `reconcileWorkflowPosition` for every in-progress deterministic task, covering a server
  restart/crash between (1) or (2) firing and the queue recording it. `finishStep()` stays
  exactly as provider-neutral as D25 already established — none of this reconciliation logic
  moves into `tools/specs/workflow/**`; it is entirely `tools/dashboard/server/ai/
  orchestration/**` and its two real caller sites.
- **Rationale:** Matches the brief's explicit instruction to inspect the real API before
  specifying a hook, and not to document a nonexistent event. Using `AgentSessionService` as
  the ownership point (rather than inventing a new event bus inside `runtime.mjs`) is the
  smaller, more honest change; covering the human path directly at its own existing
  synchronous call site is simpler than trying to force human decisions through an
  agent-turn-shaped event.
- **Consequences:** `automatic-workflow-continuation` (task 29)'s `allowed_paths` include
  `tools/dashboard/server/ai/sessions/service.mjs` and `tools/dashboard/server/specs/
  human-step-transport.mjs` in addition to its own `orchestration/**` tree and
  `ai/routes.mjs` — it does not touch `runtime.mjs` itself (no new public API needed there).
- **Corrected 2026-09-22 (pass 12 — human branch no longer auto-activates — see D47):** "if
  `continuation: auto` — enqueues the destination, then calls `admitAgentExecution`" applied
  this uniformly regardless of executor. Corrected: for an **agent-owned** destination, this
  is unchanged. For a **human-owned** destination, `reconcileWorkflowPosition` no longer calls
  `startHumanStep` automatically at all (D47 — that write would dirty `change.yaml` before
  any commit finalizes it, risking exactly the leak D47 fixes) — instead it makes the
  interaction *available* (a definition-derived preview, no mutation); `startHumanStep` fires
  only as the first half of the user's own combined Approve/Request-changes operation (D47).
  `admitAgentExecution` is never called for the human branch, consistent with D49.
- **Date:** 2026-09-22 (human-branch activation corrected 2026-09-22, pass 12 — see D47)
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/29-automatic-workflow-continuation.md`.

## D43: Durable dependency-consumption provenance, recorded at admission — remediation membership is evidence-based, never guessed

- **Question:** Remediation-group derivation (D31) said "find dependents that became active
  while the release was in effect" — but `workflow_progress.history` does not reliably record
  activation time or release-epoch provenance, especially across multiple release/invalidate/
  re-release cycles for the same dependency. How is "T2 actually started because of T1's
  release X, not some other/later release" known reliably, including after a restart?
- **Decision:** Introduce a durable dependency-consumption record, written at the moment a
  task is actually **admitted** to start (D41's `admitAgentExecution`, not merely enqueued) when
  that task has an unsatisfied-without-release dependency currently satisfied only via a
  release epoch (D40): `.nevo-ai-local/dependency-consumption/<change>/<consumingTaskId>/
  attempt-<n>.json`, shape `{consumingTaskId, consumingAttempt, dependencyTaskId,
  releaseEpoch: {step, attempt}}` (atomic temp-file-then-rename, same convention family as
  `operation-record.mjs`). Remediation-group derivation (D31) reads these records directly:
  when a release epoch is invalidated (D40), every consumption record whose `releaseEpoch`
  matches that exact epoch identifies a real group member — never inferred from current task
  state, `workflow_progress` timestamps that aren't actually persisted, or "became active
  while the release was in effect" reasoning.
- **Rationale:** Matches the brief precisely: do not guess consumption from current state or
  unpersisted timestamps; the exact local record format is this pass's to decide, but it must
  identify the dependency task, the specific release epoch consumed, the consuming task/
  attempt, and survive restart — all four are satisfied by this record.
- **Consequences:** `dependency-release-and-invalidation` (task 27) owns reading/deriving
  remediation groups from these records; `automatic-workflow-continuation` (task 29) owns
  writing them, since admission (D41) is where "this task is starting, and here is which
  release epoch its currently-satisfied dependency relies on" is actually known.
- **SUPERSEDED 2026-09-22 (pass 12) — see D48 for the corrected recording point and
  record shape.** "Recorded at admission" is wrong: a session being admitted does not imply
  `workflow step start` will ever actually succeed. D48 moves recording to successful step
  activation inside workflow core (`handleWorkflowStepStart`, `cli.mjs`), owned entirely by
  task 27 — `automatic-workflow-continuation` (task 29) no longer writes consumption records
  at all. D48 also corrects the record shape from one dependency per record to an array
  covering every release-based dependency an attempt relies on. This entry's remaining
  correct content — evidence-based remediation lookup, never guessed from state/timestamps —
  is restated, unchanged, under D48.
- **Date:** 2026-09-22 (recording point and shape corrected 2026-09-22, pass 12 — see D48)
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tasks/29-automatic-workflow-continuation.md`.

## D44: `SuspensionProjection` is a separate layer — `TaskProjection`/`projectTask()` stays pure and untouched

- **Question:** D10 established `TaskProjection` as a pure workflow/domain projection —
  confirmed still true today: `projectTask(task, change, options)`
  (`tools/specs/workflow/task-projection.mjs`) takes only in-memory arguments and does no
  file I/O of its own. Task 27's `suspensions` field was specified directly on
  `TaskProjection` in the prior pass — but reading `.nevo-ai-local/remediation-groups/**`
  from inside `projectTask()` would make it read filesystem/orchestration state, breaking the
  purity D10 already established and this pass must not regress.
- **Decision:** `projectTask()` is **not modified** to add `suspensions` or any other
  orchestration-derived field — it keeps its exact current signature and purity. A new,
  separate function, `projectSuspensions(task, change)`
  (`tools/specs/workflow/suspension-projection.mjs`, owned by `dependency-release-and-
  invalidation`, task 27, alongside the remediation/consumption records it already reads),
  reads the durable remediation-group records (D36) and dependency-consumption records (D43)
  and returns `{taskId, suspensions: [{taskId, reason, groupId}]}` for a task. Composition
  happens one layer up, mirroring D10's existing three-layer shape:
  `TaskProjection` (pure) + `SuspensionProjection` (orchestration-derived) →
  `ExecutionReadiness` (must now explicitly check `SuspensionProjection` and refuse readiness
  for a suspended task — a real behavior addition to `readiness-policy.mjs`, not just a data
  pass-through) → `DashboardActionProjection` (combines both into the DTO, alongside the
  unchanged `blockedBy`, D37).
- **Rationale:** Matches D10's own purity requirement, restated as a hard constraint this pass
  must not regress; keeps orchestration/runtime state (suspensions) architecturally separate
  from filesystem/runtime-independent domain state (`TaskProjection`), exactly the same
  separation D10 already drew between "pure projection" and "readiness."
- **Consequences:** `execution-readiness-policy`'s existing file
  (`tools/specs/workflow/readiness-policy.mjs`, already verified/implemented by task 13) gains
  a new check — a suspended task's readiness is refused — making this pass's only edit to an
  already-verified task's file an explicit, additive behavior change, not a silent one.
  `dependency-release-and-invalidation` (task 27) owns `suspension-projection.mjs`; no task
  in this pass adds `.nevo-ai-local/**` reads to `task-projection.mjs`.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tools/specs/workflow/readiness-policy.mjs`.

## D45: A pending human decision does not pause the rest of the spec's sequential queue

- **Question:** The design so far implicitly assumed a human-owned step awaiting a decision
  freezes the whole spec's queue — no other task's agent-owned work runs until the human
  responds. Is that the intended model, or should other agent-owned queued work continue
  sequentially while a human decision is pending (possibly letting several human decisions
  accumulate)?
- **Decision:** **Model B — the sequential queue continues past a pending human decision.**
  A human-owned step reaching `waiting-for-step-start`/being auto-activated (D27) never
  occupies the spec's single-execution slot (D33) — that slot is specifically for
  **agent-owned** executions, and a human decision is not one. While `T1` awaits a human
  decision, `T2`/`T3`'s own agent-owned work may continue, one at a time, through the same
  queue. Several human decisions may accumulate simultaneously across different tasks — each
  surfaces its own `HumanStepSurface` interaction independently; the owner is not forced to
  resolve them strictly one at a time.
- **Rationale:** (1) Does not weaken D33 — D33's invariant is scoped to agent-owned
  executions specifically, and a human decision was never counted against it. (2) Matches the
  batch/queue feature's own original purpose (select several tasks, let Nevo manage them) —
  pausing the entire queue behind the first task to reach a human gate would make batching
  provide little value whenever any task needs sign-off, which defeats the point of batching
  at all. (3) Source-control safety: inspected for `standard-v1` specifically —
  `human-verification` is reached only after `review`'s own `commit-and-push` finalize has
  already landed that task's work, so a pending human decision on `T1` never leaves `T1`'s own
  worktree state in a way `T2`/`T3`'s independent, unrelated implementation work could
  conflict with. A future workflow definition whose human step sits *before* some of its own
  task's remaining commits would need this re-examined for that specific definition — not a
  concern for `standard-v1` today.
- **Consequences:** The sequential queue's eligibility computation (`deterministic-sequential-
  queue`, task 28) never excludes an item merely because a different task in the same spec has
  a pending human interaction. `admitAgentExecution` (D41) only ever checks for an active
  **agent** execution, never a pending human one.
- **Re-verified 2026-09-22 (pass 12, after the D47 Git-ownership fix) — this decision stands,
  strengthened.** Rationale item 3 originally grounded source-control safety in "T1's *prior
  step's* commit already landed before human-verification is reached" — true, but incomplete:
  it did not yet address T1's *own* human-step activation write. D47 closes that gap directly
  (no activation write happens merely to show the interaction; the one write that does happen
  is finalized atomically, under a shared lock, as part of the same user operation) — so this
  decision's guarantee now holds for the actual reason needed (no unowned dirty state from
  T1's human step, at any point), not only the previously-checked one (T1's prior step's own
  commit). Several human decisions may still accumulate safely, and each submit remains
  independently attributable to the one user operation that produced it (D47).
- **Date:** 2026-09-22 (re-verified 2026-09-22, pass 12 — see D47)
- **Affected artifacts:** `areas/deterministic-sequential-queue.md`,
  `areas/workflow-continuation-and-session-handover.md`,
  `tasks/28-deterministic-sequential-queue.md`, `tasks/29-automatic-workflow-continuation.md`.

## D46: "Batch" is a user-facing selection concept; "queue" is the runtime/orchestration concept — renamed accordingly

- **Question:** The runtime abstraction is a deterministic sequential queue, not a concurrent
  batch orchestrator — the prior pass's own task/area identifier,
  `deterministic-batch-orchestrator`, still named it after the wrong mental model even after
  its content was corrected to be sequential.
- **Decision:** Renamed throughout this specification: `deterministic-batch-orchestrator` →
  **`deterministic-sequential-queue`** (task id, task file `tasks/28-deterministic-sequential-
  queue.md`, area file `areas/deterministic-sequential-queue.md`, and every cross-reference in
  `owner-decisions.md`/`overview.md`/other tasks' `depends_on`/prose). "Batch" remains the
  correct, plain word for the **user-facing** selection UX (the checkbox picker, "Publish
  selected tasks," "Batch Publish") — it is never used again as a runtime/module/ownership
  concept. "Queue" is the one runtime/orchestration concept for the sequential execution
  mechanism itself.
- **Rationale:** Matches the brief directly; prevents future confusion between the UX concept
  (what the user selects) and the runtime concept (how Nevo executes the selection) from
  bleeding into code ownership.
- **Consequences:** No behavior change — this is a naming-only correction, applied
  mechanically across every affected file.
- **Date:** 2026-09-22
- **Affected artifacts:** `change.yaml`, `overview.md`, every `D<n>` entry and area/task file
  that previously referenced `deterministic-batch-orchestrator`.

## D47: A human interaction is visible before activation; Approve/Request-changes performs one combined, self-owned operation — no unowned dirty `change.yaml` mutation

- **Question:** D27/D45's design has `startHumanStep` fire automatically on arrival to make
  `HumanStepSurface` visible without a meaningless "Start" click. **Grounded fact:**
  `startHumanStep` (`tools/specs/workflow/human-step/operations.mjs`) calls
  `ensureStepActivated` directly, which mutates `workflow_progress` (hence `change.yaml`) for
  a `phase: 'new'`/`'completed'` activation — confirmed by reading the function. It performs
  no commit of its own; only the later `submitHumanStepResult` → `finishStep` commits (via
  the step's `finalize: [{id: commit-and-push}]`). Separately, `CommitAndPushAction`
  (`commit-and-push.mjs`) always `derived.push('specs/active/<changeSlug>/change.yaml')` —
  confirmed by reading the function — meaning **any** task's own commit-and-push in that same
  change stages and commits the *entire current on-disk* `change.yaml`, including any other
  task's still-uncommitted mutation sitting in the same file. Under D45, a different task
  (T2) may keep running its own agent-owned work while T1 waits on a human — so T1's
  auto-activation mutation could sit uncommitted exactly long enough for T2's own
  `finishStep`/commit to sweep it in, silently, as an unrelated change — the identical
  ownership bug D29/Finding 11 already fixed for Publish, recurring here for human
  auto-activation.
- **Decision:** Separate **"human interaction available"** from **"human step formally
  activated"**:
  1. **Interaction preview requires no mutation.** The dashboard action DTO/projection layer
     (`DashboardActionProjection`, already-verified task 14's file,
     `tools/dashboard/server/specs/actions.mjs`) computes an interaction-actions preview
     (`{result?, label, feedbackRequired}[]`) for a `waiting-for-step-start` position whose
     destination step is human-owned, derived **entirely from the workflow definition's own
     declared transitions for that step** (`action.label`/`action.feedback.required`/`value`
     — the exact same fields the *active*-state descriptor already reads) — no
     `ensureStepActivated` call, no `workflow_progress` write, no `change.yaml` mutation.
     `HumanStepSurface` renders this preview identically to the active-interaction case — the
     user sees the real Approve/Request-changes controls immediately, with zero meaningless
     click, and zero unowned dirty state.
  2. **One combined, self-owned operation on submit.** When the user selects a result, one
     new domain operation (owned by `human-step/operations.mjs`, e.g.
     `activateAndSubmitHumanStep`) performs, within a single request/call, in order:
     `startHumanStep` (activation) immediately followed by `submitHumanStepResult` (which
     itself durably finalizes via `finishStep`'s existing commit-and-push). The whole
     sequence is the one user action's own responsibility to finalize — no intervening
     `await` boundary hands control back to any other caller between the activation write and
     its own commit.
  3. **A shared, cross-process git-finalize lock serializes every mutate-then-commit
     operation — not an in-process mutex.** Because T2's own agent-driven `finishStep` can
     run concurrently with T1's human decision (D45), these two writers must be serialized.
     **Grounded fact:** an agent's `workflow step finish` runs inside the agent's own CLI
     subprocess (`node tools/specs.mjs workflow step finish ...`), a **separate OS process**
     from the dashboard server — unlike D41's admission lock (purely dashboard-internal, an
     in-process promise-chain mutex is correct there), a lock guarding this critical section
     must be **cross-process**. Corrected: `withGitFinalizeLock(fn)` lives entirely in
     **workflow core** (`tools/specs/workflow/git-finalize-lock.mjs`), implemented as a
     simple advisory file lock under `.nevo-ai-local/locks/git-finalize.lock` (exclusive
     file creation, retry-with-backoff acquisition, delete-on-release — the same atomic-file
     convention already used throughout `.nevo-ai-local/**`, not a new kind of
     infrastructure) — reachable identically from a CLI subprocess or the dashboard's own
     process. `finish-operation.mjs`'s `finishStep`, `human-step/operations.mjs`'s new
     `activateAndSubmitHumanStep`, and `publish/operation.mjs`'s `publishTask`/Batch Publish
     each acquire it around their own mutate-then-commit critical section — entirely within
     `tools/specs/workflow/**`, no dashboard involvement needed for correctness. This is the
     same class of fix D29 already made for Publish, generalized to cover the newly legal
     T1-human/T2-agent concurrency D45 introduces, and extended to close the equivalent,
     previously-unnoticed Publish-vs-agent-finishStep race the same mechanism also covers.
  4. **`HumanStepSurface`'s existing declarative action rendering is unchanged** (Finding 8) —
     this decision changes only *when* the underlying mutation happens, never what the user
     sees or which actions a definition can declare.
- **Rationale:** Matches the brief's preferred model exactly: distinguish interaction-available
  from formally-activated; one user operation does startHumanStep + submitHumanStepResult +
  finalization; guarantee no unowned tracked Git mutation survives for another task to absorb.
- **Consequences:** `startHumanStep` is no longer called automatically on arrival — the
  orchestrator's reconciliation (D42) computes/exposes the preview instead of activating.
  `dependency-release-and-invalidation` (task 27) owns creating
  `tools/specs/workflow/git-finalize-lock.mjs` and inserting its acquisition into
  `finish-operation.mjs`'s own commit stage (a small, additive wrap, not a redesign of
  `finishStep`) — task 27 already needs core-engine access for its own D40/D43/D48 work, and
  comes earliest in the task graph among the three real callers, avoiding a dependency-order
  inversion. `automatic-workflow-continuation` (task 29) owns the new
  `activateAndSubmitHumanStep` combined operation in `human-step/operations.mjs`, importing
  the lock task 27 created. `user-mutation-source-control-finalization` (task 31) imports the
  same lock into `publish/operation.mjs`'s own commit stage — task 31 gains a `depends_on`
  edge to `dependency-release-and-invalidation` for it (still forward in task-graph order:
  27 < 31).
- **SUPERSEDED IN PART 2026-09-22 (pass 13) — item 3's lock boundary was self-contradictory;
  see D50/D51 for the corrected model.** Item 3 said `activateAndSubmitHumanStep` and
  `finishStep` "each acquire" the lock "around their own mutate-then-commit critical
  section" — but `activateAndSubmitHumanStep` **calls** `submitHumanStepResult` →
  `finishStep` internally (item 2), so if both independently acquire the same
  non-reentrant advisory lock, the combined operation self-deadlocks (or times out) against
  itself. Separately, `finishStep`'s own tracked mutation (`ensureUpdateTask`) happens
  **before** its commit stage (`ensureCommit`) — if the lock is acquired only "around" the
  commit stage as item 3's wording implied, the mutation itself is unprotected, leaving the
  exact dirty-then-uncommitted window this whole decision exists to close. D50 corrects the
  boundary (lock wraps from the first tracked mutation through the commit, one owner per
  combined operation, no recursive acquisition) and D51 adds crash recovery for the lease
  itself. Items 1, 2, and 4 above (mutation-free preview; one combined user operation; unified
  `HumanStepSurface` rendering) are unaffected and still stand.
- **Date:** 2026-09-22 (lock boundary corrected 2026-09-22, pass 13 — see D50/D51)
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `areas/dependency-release-and-invalidation.md`,
  `areas/user-mutation-source-control-ownership.md`,
  `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/29-automatic-workflow-continuation.md`, `tasks/32-dashboard-orchestration-wiring.md`,
  `tasks/31-user-mutation-source-control-finalization.md`.

## D48: Dependency consumption is recorded at successful step activation inside workflow core, not at AI-session admission; one record holds all of an attempt's release-based dependencies

- **Question:** D43 recorded dependency consumption inside `admitAgentExecution` — but a
  session being admitted does not imply `workflow step start` will ever actually succeed (the
  agent might never run it, or it might fail). Separately, D43's record shape assumed exactly
  one dependency per consuming attempt, but a task may `depends_on` several upstream tasks,
  more than one of which may currently be satisfied only via a release epoch.
- **Decision:**
  1. **Recording point moves to actual step activation, inside workflow core.** Dependency
     checking (`checkTaskDependencies`) already gates whether a task's **first** step
     (`phase: 'new'`, no prior `workflow_progress` — dependencies are checked once, at a
     task's initial activation, never re-checked at each subsequent step within the same
     task) may activate at all. The consuming task id, consuming step, consuming attempt, the
     authoritative dependency-satisfaction result, and the exact active release epochs are
     all simultaneously available at exactly one place: right after `ensureStepActivated`
     succeeds for that first-step activation, inside the CLI-level caller
     (`handleWorkflowStepStart`, `tools/specs/workflow/cli.mjs`) — the one call site every
     real `workflow step start` invocation (agent-driven or raw CLI) already goes through.
     `dependency-release-and-invalidation` (task 27) exports the recording function; `cli.mjs`
     calls it immediately after a successful first-step activation. This keeps the write
     entirely within `tools/specs/workflow/**` — no AI/session/dashboard involvement needed
     for correctness, matching "keep AI/session orchestration outside workflow core."
     `admitAgentExecution` (D41) no longer records consumption at all — it has no reliable way
     to know whether the admitted session's turn will ever actually reach `workflow step
     start`, so it must not guess.
  2. **Multi-dependency record shape.** One record per consuming attempt, holding every
     release-based dependency it currently relies on:
     ```
     {
       consumingTaskId, consumingStep, consumingAttempt,
       dependencies: [ { taskId, releaseEpoch: { step, attempt } } ]
     }
     ```
     at `.nevo-ai-local/dependency-consumption/<change>/<consumingTaskId>/attempt-<n>.json`,
     written atomically as one file covering all of that attempt's release-based
     dependencies together — never one file per dependency. A dependency currently satisfied
     via a terminal `outcome: success` (not a release epoch) needs no entry here unless a
     future provenance need arises — out of scope now.
  3. **Remediation lookup matches on any dependency entry.** `findConsumersOfEpoch` (task 27)
     returns a consuming task if **any** entry in its `dependencies` array names the
     invalidated epoch — a task with two release-based dependencies is found via either one.
- **Rationale:** Matches the brief precisely: correctness must align with actual step
  activation, not session admission; a task can depend on multiple upstream tasks
  simultaneously and the record must reflect that atomically.
- **Consequences:** `automatic-workflow-continuation` (task 29) drops its D43-era
  consumption-recording responsibility entirely — its own file no longer needs
  `dependency-consumption.mjs` write access. `dependency-release-and-invalidation` (task 27)
  gains `tools/specs/workflow/cli.mjs` in its `allowed_paths` for the one call-site insertion.
- **SUPERSEDED IN PART 2026-09-22 (pass 13) — see D52/D53/D54.** Three real gaps found on
  fresh review: (a) "right after `ensureStepActivated` succeeds" leaves a genuine crash
  window — activation can durably succeed while the very next line (the consumption write)
  never runs, and once that happens the task is no longer a fresh "first activation," so the
  missing provenance could never be reconstructed on retry (D52 introduces a durable,
  resumable start-operation spanning both); (b) gating recording on "first-ever task
  activation" is wrong for rework — a task returned to `implementation` for a second attempt
  after `T1` was invalidated-then-fixed must be able to consume `T1`'s *new* release epoch on
  that second attempt, which "first-ever" by construction forbids (D53 replaces it with a
  declarative, step-level `consumesDependencies: true` flag, decoupled from step-graph
  position or attempt number); (c) one record path per `<change>/<consumingTaskId>/
  attempt-<n>.json` collides the moment more than one declared consuming step could exist for
  a task, and even for a single declared step conflates identity across the step it belongs
  to (D53/D54 add `<step>` to the record's path and to remediation's authoritative-record
  resolution). Item 3 (remediation matches "any dependency entry") is also refined by D54:
  matching *any historical* record is wrong once a later attempt has superseded an earlier
  dependency snapshot — only a task's *authoritative* (latest relevant) record should be
  checked. The core shape (`{consumingTaskId, consumingStep, consumingAttempt, dependencies:
  [...]}`) and the "no session-admission guessing" principle both survive unchanged into
  D52–D54; only the recording point's durability, the recording trigger, the path identity,
  and the remediation-matching rule are corrected.
- **Date:** 2026-09-22 (recording durability, trigger, identity, and matching rule corrected
  2026-09-22, pass 13 — see D52/D53/D54)
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/25-workflow-continuation-schema.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tasks/29-automatic-workflow-continuation.md`.

## D49: `admitAgentExecution`'s claim lifecycle is atomic through to durable visibility; human dispatch is a distinct path that never calls it

- **Question:** D41 described admission as "lock → check → mark occupied → return admitted,"
  leaving the claim's actual lifecycle underspecified — what happens if session/turn creation
  fails *after* the claim is marked? Separately, D41's own wording ("the only path that may
  create an agent session **or call `startHumanStep`**") contradicted task 29's own, correct
  statement that a human destination never calls admission at all.
- **Decision:**
  1. **Renamed** `admitExecution` → **`admitAgentExecution`** throughout (mechanical, no
     behavior change beyond what's specified below) — the name itself now states what it
     gates: agent-owned execution only.
  2. **Atomic claim lifecycle.** `admitAgentExecution(specId, candidate)` owns the full
     check-and-claim-through-to-durable-visibility boundary, not merely a permission check for
     some other code path to act on later: acquire the spec's lock → re-read active-execution
     state → if occupied, reject/defer (candidate stays eligible, unchanged) → if free, mark
     occupied → **synchronously drive session/turn creation to the point its canonical
     identity is durably observable to a subsequent admission check** (e.g. the binding
     record is persisted) → only then release the lock. **If session/turn creation fails
     after the claim was marked but before it becomes durably visible**, `admitAgentExecution`
     rolls back the claim (clears "occupied") before releasing the lock or returning — the
     candidate remains eligible/retryable in the queue; the spec is never left permanently,
     falsely occupied.
  3. **Orchestrator dispatch, two distinct branches, never conflated.** Every destination
     resolved by `reconcileWorkflowPosition`/a manual or batch Start branches once, on
     `executor`: **agent-owned** → enqueue → `admitAgentExecution` → (on admission) create/
     reuse a session per D26 → the spec-level single-agent-execution slot (D33) applies.
     **human-owned** → expose/activate the human interaction path (D47's preview-then-
     combined-operation model) → **no agent-execution slot is claimed, `admitAgentExecution`
     is never called for this branch, and it is never described as "agent admission" in any
     artifact.**
- **Rationale:** Matches the brief precisely: the invariant must be real (atomic through to
  visibility, with rollback on failure), and the two dispatch kinds must never share
  terminology that implies a human decision consumes the same slot an agent execution does.
- **Consequences:** `tasks/29-automatic-workflow-continuation.md`'s `admission.mjs` gains an
  explicit rollback path; every reference to "admission" for the human branch is removed from
  every area/task file — human dispatch is described only as exposing/activating the
  interaction (D47), never as a form of admission.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/29-automatic-workflow-continuation.md`, `tasks/28-deterministic-sequential-queue.md`,
  `tasks/32-dashboard-orchestration-wiring.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D50: The git-finalize lock wraps from the first tracked mutation through the commit; one lease per combined operation, never recursive acquisition

- **Question:** D47 said `finishStep` and `activateAndSubmitHumanStep` "each acquire" the
  git-finalize lock "around their own mutate-then-commit critical section" — but
  `activateAndSubmitHumanStep` *calls* `submitHumanStepResult` → `finishStep` internally, so
  if both independently call `withGitFinalizeLock`, the combined operation acquires the same
  non-reentrant lock twice from within its own call stack — self-deadlock (or a timeout
  against itself) on every single human submission. Separately, exactly where does the lock
  need to start? `finishStep`'s own tracked mutation (`ensureUpdateTask`, writing
  `workflow_progress`) happens **before** its commit stage (`ensureCommit`) in the existing
  `FINISH_STAGE_IDS` order (`verify-gates, update-task, commit, push, transition`) — if the
  lock is only held "around" the commit stage, `ensureUpdateTask`'s own write is unprotected,
  leaving exactly the dirty-then-uncommitted window this whole mechanism exists to close.
- **Decision:**
  1. **Lock boundary: first tracked mutation through the commit, never narrower.**
     `finishStep` itself acquires `withGitFinalizeLock` **before** `ensureUpdateTask` begins
     and releases it **after** `ensureCommit` completes (success or failure — release in a
     `finally`) — covering the one continuous window where tracked state can be dirty and
     uncommitted. `push`/`transition` (stages after `commit`) run **outside** the lock — they
     don't mutate local tracked files a concurrent commit could sweep in, and holding a
     cross-process lock through a network-bound push would cost throughput for no
     correctness benefit.
  2. **`withGitFinalizeLock(fn, existingLease?)` supports explicit lease-passing — never
     implicit reentrancy.** When called with no `existingLease`, it acquires a fresh lease,
     runs `fn(lease)`, and releases in `finally` (this is `finishStep`'s own normal,
     CLI-driven path, and `publishTask`'s own path — both are the sole owner of their own
     lease). When called *with* an `existingLease` already held by the same logical
     operation, it does **not** acquire a second lease or block — it runs `fn(existingLease)`
     directly, and the *original* acquirer remains solely responsible for eventual release.
     This is an explicit parameter, never automatic/implicit reentrancy detection — a caller
     must know it already holds the lease to pass it.
  3. **`activateAndSubmitHumanStep` acquires exactly one lease for the whole combined
     operation.** It calls `acquireGitFinalizeLease()` once, up front (before `startHumanStep`
     — activation is itself a tracked mutation that must be protected until it's committed),
     passes that lease through to `startHumanStep` (which itself performs no locking of its
     own — the caller holds the lease around it) and into `submitHumanStepResult` → `finishStep`
     (as `existingLease`, so `finishStep` does not acquire a second one), and releases the one
     lease itself, once, after `finishStep` returns (success or failure, `finally`). This
     makes the *entire* activate-then-finalize sequence one continuous critical section under
     one owner, with no recursive acquisition anywhere in the call stack.
  4. **`finishStep` gains an optional `finalizeLease` input** (threaded via its existing
     `context`/inputs shape, not a new top-level required parameter) — when present, it is
     used as the `existingLease` passed to `withGitFinalizeLock`; when absent (the normal,
     directly-CLI-driven `workflow step finish` path), `finishStep` acquires its own, exactly
     as before this correction.
  5. **`publishTask`/Batch Publish are unaffected by this correction** — they have no inner
     call into `finishStep`, so they simply acquire-and-release their own single lease around
     their own mutate-then-commit sequence, exactly as D47 already specified.
- **Rationale:** Matches the brief precisely: make it impossible for human submit to
  self-deadlock, for Publish to commit an agent's uncommitted mutation, or for an agent's
  `finishStep` to commit Publish's/the human operation's uncommitted mutation — by choosing
  one explicit ownership model (lease-passing) rather than an implicit reentrant lock, which
  risks accidentally serializing unrelated concurrent operations that happen to share a call
  frame in the future.
- **Consequences:** `dependency-release-and-invalidation` (task 27) implements
  `withGitFinalizeLock`'s lease-passing signature and moves `finishStep`'s own lock
  acquisition to wrap `ensureUpdateTask` through `ensureCommit` (still a small, additive
  change to `finish-operation.mjs` — the stage sequence itself is unchanged, only lock
  acquisition/release points are added around it). `automatic-workflow-continuation`
  (task 29) threads the one acquired lease through `activateAndSubmitHumanStep`'s own calls.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `areas/workflow-continuation-and-session-handover.md`,
  `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/29-automatic-workflow-continuation.md`.

## D51: The git-finalize lease supports stale-owner recovery via PID-liveness, not lock-file age alone

- **Question:** A plain "exclusive file create, delete in `finally`" advisory lock (D47's
  original design) never releases if the holding process is killed or crashes before the
  `finally` runs — since this lock is now a real correctness primitive (D50), a stale lock
  left behind by a crash must not permanently block every future Publish/finish/human-submit
  operation.
- **Decision:** The lease file's content becomes `{ownerId, pid, createdAt}` (`ownerId` a
  fresh random id generated per acquisition attempt, not reused). Acquisition: exclusive file
  creation; on `EEXIST`, read the existing lease and check `process.kill(existingLease.pid,
  0)` (a standard, synchronous, zero-signal liveness probe — throws `ESRCH` if that pid is
  not running, does not actually signal anything if it is). If the recorded pid is
  **confirmed dead**, the lease is stale — delete it and retry acquisition immediately (safe:
  a dead process cannot still be relying on the lock). If the recorded pid **is** alive (or
  the probe is inconclusive), treat this as genuine contention — retry with backoff up to a
  bounded overall timeout, then fail with a clear, actionable error naming the lock file and
  the current holder's pid (never hang indefinitely, never silently steal a live lock).
  Release verifies ownership first: read the current lease file, compare its `ownerId` to the
  one this caller was issued at acquisition time — delete only on a match; on a mismatch
  (someone else already reclaimed it, implying this caller's own liveness was
  mis-detected as dead — an accepted, extremely narrow residual risk of PID-based recovery,
  identical to that of established lockfile libraries using the same technique), skip
  deletion rather than removing a lease this caller no longer actually owns.
- **Rationale:** Matches the brief precisely: exclusive acquisition stays atomic; a live
  owner is never stolen (liveness is checked, not merely lock age); a genuinely orphaned lock
  is safely reclaimed; timeout still exists for real contention; unlock verifies ownership;
  the mechanism works identically whether the two contending processes are a CLI subprocess
  and the dashboard server or two of either kind, since PID liveness is a normal OS-level
  fact, not something scoped to one process's own memory.
- **Consequences:** `git-finalize-lock.mjs` (task 27) implements this acquire/reclaim/release
  algorithm; no external locking library or new runtime dependency is introduced — it reuses
  Node's built-in `process.kill(pid, 0)` and the existing atomic-file-write convention.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`.

## D52: Step activation and its dependency-consumption snapshot become durable together via a resumable start-operation, distinct from finish-operation records

- **Question:** D48 wrote the consumption record immediately after `ensureStepActivated`
  succeeded, as two separate, sequential actions. If the process crashes between them,
  `workflow_progress` shows the step already `active`, but no consumption record exists — and
  since the task is no longer a fresh "first activation" on retry (that concept is itself
  replaced by D53, but the crash-window problem is independent of it), the missing
  provenance could never be reconstructed, especially once upstream dependency state has
  since moved on.
- **Decision:** Introduce a durable, resumable **start-operation** record — a distinct record
  family from `finish-operation.mjs`'s own (per the brief: do not overload finish-operation
  records with a different identity) — at `.nevo-ai-local/workflow-start-operations/<change>/
  <task>/<step>/attempt-<n>.json`, with its own small module (owned by
  `dependency-release-and-invalidation`, task 27, alongside its other new primitives),
  reusing the same atomic-write/intent-then-verify *pattern* `operation-record.mjs` already
  established (not its literal file family, to keep the two identities distinct as the brief
  requires). Flow, for a step declaring `consumesDependencies: true` (D53):
  1. **Plan + freeze the snapshot.** Before any mutation, resolve dependency satisfaction
     (`checkTaskDependencies`/`evaluateDependencySatisfaction`) and collect every
     currently-release-based dependency into a snapshot. Write the start-operation record
     with `status: 'running'`, this frozen `dependencySnapshot`, and per-stage markers
     (`snapshot: completed`, `activate: pending`, `record-consumption: pending`).
  2. **Activate.** Call `ensureStepActivated`. Mark `activate: completed` in the record.
  3. **Record consumption from the frozen snapshot — never re-resolved.** Call
     `recordDependencyConsumption` using exactly the snapshot captured in step 1, even if
     real dependency/release state has since changed. Mark `record-consumption: completed`
     and the record's own `status: 'completed'`.
  4. **Resume semantics, mirroring `finish-operation.mjs`'s own established discipline:** on
     the next `workflow step start` for this task/step, check for an in-flight (`status !==
     'completed'`) start-operation record first. If found: resume from its **already-frozen**
     `dependencySnapshot` (never re-resolve to newer epochs) and complete whichever stages
     are still `pending`, idempotently (re-running `record-consumption` for an
     already-completed `activate` stage is safe and produces the same record). If the live
     `workflow_progress` state is inconsistent with what the record expects (e.g., activation
     the record expected to have happened, didn't, per the real workflow state) — fail closed
     with a clear reconciliation-required-style error, exactly as `finish-operation.mjs`
     already does for its own ambiguous intents, never guessing.
- **Rationale:** Matches the brief precisely: a successful `workflow step start` must mean
  both the activation *and* its dependency snapshot are durably settled, together; retries
  must never silently re-resolve to different upstream state than what the original attempt
  actually relied on.
- **Consequences:** `dependency-release-and-invalidation` (task 27) owns this new record
  family and its resume logic, wired into the same `cli.mjs` call site D48 already
  identified. `tools/tests/deterministic-dependency-satisfaction.test.mjs` gains crash-resume
  coverage for this specific boundary.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`.

## D53: Dependency consumption is declared per step (`consumesDependencies: true`), recorded on every relevant attempt, identified by step and attempt

- **Question:** D48 gated consumption recording on a task's first-ever step activation —
  which cannot represent a rework cycle: after `T1`'s release is invalidated and `T1` is
  fixed (a *new* release epoch), a downstream task sent back to `implementation` for its own
  second attempt must be able to consume `T1`'s *new* epoch then, not only at its own
  long-past first activation. The brief also explicitly forbids inferring this from a literal
  step-name check (`if step === 'implementation'`).
- **Decision:**
  1. **Declarative step metadata, additive schema (task 25 owns it, not hidden inside task
     27's implementation text).** A new, optional step-level field,
     `consumesDependencies: true` (default `false`/absent), added to the same consolidated
     schema D39 already tracks (`continuation`, `execution`, `releasesDependencies`,
     `invalidatesDependencyRelease`, `schedulingPriority`). `standard.yaml`/`standard-v1.yaml`
     migration: `implementation` gets `consumesDependencies: true` (it is the step that
     performs the actual dependency-consuming work, on every attempt — first or rework);
     `review`/`human-verification` do **not** (they consume no new upstream dependency,
     unless a future definition explicitly declares otherwise).
  2. **Recording triggers on every activation of a declared step, not "first-ever."** The
     start-operation flow (D52) runs whenever a step declaring `consumesDependencies: true`
     activates, for **any** attempt number — `handleWorkflowStepStart` checks the *target
     step's own* declared flag, never the task's own history/attempt-count, and never a
     literal step-id/name comparison. A newly-authored, arbitrarily-named step that declares
     the flag works identically, with zero application-code changes.
  3. **Record identity includes step, not just task.** Path becomes
     `.nevo-ai-local/dependency-consumption/<change>/<task>/<step>/attempt-<n>.json` — the
     previous `<change>/<task>/attempt-<n>.json` shape (no step segment) could collide the
     moment more than one declared step exists for a task, and conflated identity even for a
     single step. Record shape is otherwise unchanged from D48: `{consumingTaskId,
     consumingStep, consumingAttempt, dependencies: [{taskId, releaseEpoch}]}`.
     `findConsumersOfEpoch` scans every `<change>/<task>/<step>/attempt-*.json` file, matching
     if any `dependencies[]` entry names the target epoch (before D54's authoritative-record
     narrowing is applied).
- **Rationale:** Matches the brief precisely: arbitrary step names must work via declarative
  metadata alone; rework attempts must be able to record fresh consumption; the schema
  addition belongs in task 25 (the one place this specification's own schema decisions live),
  not buried in task 27's implementation prose.
- **Consequences:** `tasks/25-workflow-continuation-schema.md` gains
  `consumesDependencies` in its consolidated schema and its own `standard-v1.yaml` migration
  entry. `dependency-release-and-invalidation` (task 27) reads the flag (never a step-name
  check) to decide whether to run the D52 start-operation flow, and adopts the corrected,
  step-scoped record path.
- **Date:** 2026-09-22
- **Affected artifacts:** `tasks/25-workflow-continuation-schema.md`,
  `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `.nevo-ai/workflows/standard-v1.yaml`.

## D54: Remediation lookup uses only a task's authoritative (latest relevant) consumption record per dependency — never any historical record

- **Question:** Once a task can record consumption more than once (D53, rework), a single
  invalidated epoch could appear in an *old*, since-superseded record even though the task's
  *later* attempt already consumed a fresh, still-valid epoch of the very same dependency.
  Flagging the task as a remediation-group member in that case would be wrong — its later
  work already moved past the stale state the old record captured.
- **Decision:** For a given `(consumingTask, dependencyTaskId)` pair, the **authoritative**
  consumption record is the one with the highest `consumingAttempt` among records sharing the
  same `consumingStep` that name that `dependencyTaskId` (ties/cross-step ordering, if a
  definition ever declares more than one consuming step for one task, resolve by the
  consuming step's own position in `workflow_progress.history` — later history entry wins;
  not needed by any current definition, but the record's own `consumingStep`+
  `consumingAttempt` fields make it resolvable without guessing if it ever is).
  `findConsumersOfEpoch` is corrected to return a task as a match **only** when its
  authoritative record for that specific dependency names the invalidated epoch — a task
  whose authoritative (latest) record already names a different, still-valid epoch is
  **not** a match, even if an older, superseded record of its own once named the
  now-invalidated one. This applies identically whether the task's own current state is
  active, waiting, completed, or terminal (D31's terminal-consumer inclusion is unaffected —
  it is about *which task states are eligible to be flagged at all*, unchanged; D54 is about
  *which of a task's own possibly-multiple records governs that check*).
- **Rationale:** Matches the brief precisely: prefer a model based on the task's latest
  applicable dependency-consumption snapshot per dependency, not "any historical record ever
  mentioned this epoch" — a later, successful attempt genuinely supersedes an earlier
  dependency snapshot, and treating a superseded record as still-live would produce false
  remediation-group membership.
- **Consequences:** `dependency-release-and-invalidation` (task 27)'s `findConsumersOfEpoch`
  gains this authoritative-record resolution step before matching; remediation-group
  derivation (D31) is otherwise unchanged.
- **SUPERSEDED 2026-09-22 (pass 14) — see D58.** "Highest `consumingAttempt` within a step,
  falling back to `workflow_progress.history` position across steps" is not a reliable total
  order: the *currently-active* consuming step's own activation is, by construction, not yet
  present in *completion* history at the moment it needs to be compared, and `consumingAttempt`
  is only chronological *within* one step, never across two independently-numbered steps
  (e.g. step A's attempt 2 could easily be chronologically later than step B's attempt 1, with
  no attempt-number relationship between them). D58 replaces this with an explicit, durable,
  monotonic `consumptionSequence` allocated once per activation — the authoritative record for
  `(consumingTask, dependencyTaskId)` becomes "highest `consumptionSequence` naming that
  dependency," full stop, regardless of which step or attempt produced it.
- **Date:** 2026-09-22 (authoritative-record ordering corrected 2026-09-22, pass 14 — see D58)
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`.

## D55: A shared-workspace-writer invariant, distinct from agent admission and the git-finalize lease

- **Question:** D50/D51's git-finalize lease only protects the mutate-then-commit *instant*
  — it is not held while an agent is actively editing the shared worktree between
  `workflow step start` succeeding and its own eventual `finishStep`. Concretely: T2's agent
  session mutates `change.yaml` (via `workflow step start`) and begins editing source files,
  leaving the worktree genuinely dirty for the *duration of its whole active turn* — not just
  a brief mutate-then-commit window. Meanwhile (legal under D45, since a pending human
  decision doesn't block other agent-owned work, and Publish/human-submit were never gated on
  "is an agent currently active" at all), the user clicks Approve on T1 or Publish on T3. That
  operation's own `withGitFinalizeLock` only guards *its own* mutate-then-commit instant — it
  has no way to know T2's worktree is *already* dirty for reasons unrelated to its own
  operation, and could fail with a scope error, interfere with T2's in-progress edits, or (in
  the worst case) sweep T2's own uncommitted `change.yaml` mutation into an unrelated commit.
  This project deliberately does not support per-task worktrees or concurrent agent
  execution, so the fix must be a new arbitration rule, not workspace isolation.
- **Decision:** Introduce an explicit **workspace-writer** invariant, a third primitive,
  never conflated with the other two:
  - **Agent-admission lock (D41/D49, unchanged):** an in-process, dashboard-only, short-lived
    mutex preventing two agent executions from being *created* concurrently for one spec.
  - **Workspace-writer slot (new, this decision):** for one specification, **at most one
    workspace-writing operation may hold it at a time.** Workspace-writing operations are: an
    active agent execution, from the moment its session is admitted until that execution
    reaches its safe completion/finalization boundary; `activateAndSubmitHumanStep`; Publish;
    Batch Publish; and any future tracked-mutation operation. A **pending** human interaction
    (not yet submitted) is **not** a workspace writer — D45 stands unchanged: it never blocks
    the sequential agent queue merely by existing. A queued user action is not a workspace
    writer until it actually begins its own tracked mutation attempt.
  - **Git-finalize lease (D47/D50/D51, unchanged in role):** a narrower, cross-process lease
    around the mutate-then-commit critical section specifically — nested *inside* whichever
    operation currently holds the workspace-writer slot (D47's own lease-passing/boundary
    rules are otherwise untouched).
  - **Behavior when a user submits a workspace mutation while an agent holds the slot:** the
    user's intent is accepted/recorded immediately (never silently dropped or bounced) but
    its tracked mutation does **not** begin — the operation waits for the workspace-writer
    slot exactly as any other blocked acquirer would, then proceeds once it is free. Before
    the scheduler admits the *next* automatic agent-queue item, it services any
    already-pending, explicitly-user-submitted workspace mutation first (D57).
- **Rationale:** Matches the brief precisely: an explicit arbitration rule, not per-task
  worktrees, parallel branches, concurrent agents, or Git merge orchestration; three
  primitives with three distinct, non-overlapping roles, stated explicitly so future work
  never re-conflates them.
- **Consequences:** `dependency-release-and-invalidation` (task 27) owns the new
  `workspace-writer.mjs` primitive (alongside `git-finalize-lock.mjs`, the same durable-file
  family). `automatic-workflow-continuation` (task 29) integrates it into
  `admitAgentExecution` (claim before session creation, release on turn-terminal) and
  `activateAndSubmitHumanStep` (claim for the operation's own duration).
  `user-mutation-source-control-finalization` (task 31) integrates it into
  `publishTask`/Batch Publish the same way.
- **Date:** 2026-09-22
- **Affected artifacts:** `owner-decisions.md`,
  `areas/workflow-continuation-and-session-handover.md`,
  `areas/dependency-release-and-invalidation.md`,
  `areas/deterministic-sequential-queue.md`,
  `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/29-automatic-workflow-continuation.md`,
  `tasks/31-user-mutation-source-control-finalization.md`.

## D56: The workspace-writer slot is a durable, recoverable record — reconciled by kind, not by a single universal liveness check

- **Question:** The slot must not exist only in memory (a server restart would either
  falsely-forever-occupy it or silently forget a real, still-relevant claim). What durable
  shape recovers correctly for both an agent's own claim (held by a session/turn the
  dashboard itself tracks) and a human-submit/Publish claim (held by the dashboard's own
  process for a short, synchronous-ish operation)?
- **Decision:** `.nevo-ai-local/workspace-writers/<specId>.json`:
  `{ownerId, kind: 'agent'|'human-submit'|'publish'|'batch-publish', specId, taskId?,
  sessionId?, turnId?, pid?, createdAt}`. Acquisition is atomic (exclusive file create);
  release verifies `ownerId` first (same discipline as D51). **Reconciliation branches by
  `kind`:**
  - **`kind: 'agent'`** — liveness is determined by the dashboard's own canonical
    session/turn state (`sessionId`/`turnId`), never a PID check (the agent's own tool-call
    subprocess is short-lived and repeated, not a single long-lived process for the whole
    turn — a PID check would be meaningless here). Release is triggered from the *same* real
    hook D42 already established: when `AgentSessionService`'s per-turn subscription reports
    that turn as terminal (completed/failed/cancelled), the workspace-writer claim for that
    execution is released as part of the same reconciliation pass. Boot-time recovery reuses
    `reconcileOrphanedTurns()`'s own existing detection of a persisted `activeTurn` left
    behind by an ungraceful restart — when it finds one, it also releases that turn's
    workspace-writer claim, if any.
  - **`kind !== 'agent'`** (human-submit/Publish/Batch Publish) — these are short,
    dashboard-process-local operations; liveness is a `pid` check against the *current*
    process's own `process.pid`. Because this whole architecture is single-server (no
    clustering), any claim whose `pid` does not match the current process's own pid at
    boot-time reconciliation is unconditionally stale (it belongs to a previous server
    lifetime) and is cleared unconditionally — a simpler, safe special case of D51's own
    PID-liveness pattern, not a new mechanism.
  - **Failed admission/session creation** (D41/D49's own rollback path) releases the
    workspace-writer claim in the same rollback, exactly as it already clears the admission
    "occupied" marker — the two are released together, atomically, from the same failure
    path.
- **Rationale:** Matches the brief precisely: acquisition atomic; live owner never stolen;
  stale owner recoverable; agent ownership reconciled against canonical session/turn state;
  failed admission releases the claim; a queued human/Publish mutation that never actually
  started never leaves the workspace falsely occupied (it never acquired the slot in the
  first place); restart reconciliation recovers a missed release — all without inventing a
  second PID-liveness mechanism for the agent case, where PID is not the right signal.
- **Consequences:** `dependency-release-and-invalidation` (task 27) owns this record's
  primitives; `automatic-workflow-continuation` (task 29) wires the agent-kind release into
  its existing Hook 1/Hook 3 reconciliation; `user-mutation-source-control-finalization`
  (task 31) relies on normal `finally`-based release plus boot-time pid-mismatch clearing for
  the Publish case.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `areas/workflow-continuation-and-session-handover.md`,
  `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/29-automatic-workflow-continuation.md`.

## D57: Explicit, already-pending user-submitted workspace mutations are serviced before the next automatically-dispatched agent item

- **Question:** When an agent releases the workspace-writer slot, there may simultaneously be
  a next agent-queue item ready, a pending human submission, a pending Publish, or a
  remediation action all wanting the slot next. What deterministic order governs this,
  chosen now rather than left to implementation?
- **Decision:** **Default policy: an explicit, already-pending user-submitted workspace
  mutation is serviced before the next automatically-dispatched agent-queue item.**
  Mechanism: `workspace-writer.mjs` maintains an in-process (dashboard-only — every real
  caller of this policy is dashboard-mediated) record of currently-waiting acquisition
  attempts, tagged by `kind`. Before `automatic-workflow-continuation`'s dispatch logic calls
  `admitAgentExecution` for the sequential queue's own `nextRunnable` item, it checks whether
  any **non-agent** (`human-submit`/`publish`/`batch-publish`) acquisition attempt is already
  waiting for this spec's workspace-writer slot. If one is, dispatch defers admitting the
  next agent item until that waiter has acquired, completed, and released the slot — the
  waiter's own acquisition, already queued in the slot's FIFO wait order, is what actually
  resolves next once the agent releases; dispatch does not additionally race it. This is a
  generic, `kind`-based policy — no application code branches on a literal action name to
  implement it.
- **Rationale:** Matches the brief's own worked example and preferred default directly (T2
  finishes; pending Approve T1; T3 queued → Approve T1 runs, then T3); reuses the FIFO
  ordering a wait-queue already provides rather than inventing a second priority mechanism,
  while still making a race between "next-agent dispatch" and "a not-yet-queued user click
  arriving at nearly the same instant" resolve deterministically toward the already-recorded
  intent, not an ad hoc timing race.
- **Consequences:** `automatic-workflow-continuation` (task 29) owns this check, immediately
  before its own `admitAgentExecution` call for the next queue item. `deterministic-sequential-
  queue` (task 28) is unaffected — it remains a pure "what's eligible" computation; this
  policy is applied one layer up, at dispatch.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `areas/deterministic-sequential-queue.md`, `tasks/29-automatic-workflow-continuation.md`.

## D58: Dependency-consumption authoritative-record ordering is a durable, monotonic `consumptionSequence`, not step/attempt/history position

- **Question:** D54's ordering rule (highest `consumingAttempt` within a step, falling back
  to `workflow_progress.history` position across different consuming steps) is not a
  reliable total order: the currently-activating step's own entry is not yet present in
  *completion* history at the exact moment it needs to be compared against another step's
  own attempts, and nothing guarantees `consumingAttempt` numbers are chronologically
  comparable *across* two independently-numbered consuming steps (schema allows arbitrarily
  many steps to declare `consumesDependencies: true`).
- **Decision:** Add a persisted, monotonically-increasing `consumptionSequence: <integer>`,
  allocated **per task**, to both the start-operation snapshot (D52) and the final
  dependency-consumption record: `{consumingTaskId, consumingStep, consumingAttempt,
  consumptionSequence, dependencies: [...]}`. **Allocation, crash-safe by construction:**
  when `planStart` creates a *new* start-operation record for a `consumesDependencies` step
  activation, it computes `consumptionSequence` as one more than the current maximum found
  across *all* of that task's own durable records (both completed
  `dependency-consumption/<change>/<task>/**` records and any `workflow-start-operations/
  <change>/<task>/**` records, in-flight or completed) and freezes it into the new record
  *before* activation mutates anything. **On resume**, the already-frozen sequence in the
  existing in-flight record is reused verbatim — never re-derived, never re-allocated — so a
  crash cannot produce two different sequence values for the same logical activation.
  **Concurrency safety** follows directly from D55: `planStart` only ever runs while this
  task's own step activation is proceeding, which — because only one agent execution can be
  active per spec (D33) and that execution holds the workspace-writer slot for its entire
  duration (D55) — can never overlap with any other workspace-writing operation for the same
  spec, so the scan-then-allocate sequence has no concurrent writer to race against. No
  separate lock or in-memory counter is introduced for this allocation.
- **Decision (authoritative-record resolution, corrected from D54):** For a given
  `(consumingTask, dependencyTaskId)` pair, the authoritative consumption record is the one
  with the **highest `consumptionSequence`** among all of that task's records (across any
  consuming step) naming that dependency — full stop, regardless of which step or attempt
  produced it. `findConsumersOfEpoch` matches only against each candidate's authoritative
  record by this rule.
- **Rationale:** Matches the brief precisely: do not infer order from step names, lexical
  step order, completion history alone, or attempt number alone; a later activation must
  always win regardless of which differently-numbered step produced it; sequence allocation
  must integrate with the already-durable start-operation rather than an in-memory counter.
- **Consequences:** `dependency-release-and-invalidation` (task 27)'s `start-operation.mjs`
  and `dependency-consumption.mjs` both gain `consumptionSequence`; `findConsumersOfEpoch`'s
  authoritative-record resolution is corrected from D54's step/attempt/history rule to this
  one, simpler, total-order rule.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D59: A workspace-writer claim releases only when its execution is *settled* — never merely because the AI/session turn (or CLI process) reached terminal

- **Question:** D56 releases an agent-kind workspace-writer claim as soon as
  `AgentSessionService`'s per-turn subscription reports the turn terminal
  (completed/failed/cancelled), or when boot-time reconciliation finds an orphaned turn. This
  is too early: a terminal AI/session turn does not imply the physical worktree is safe. A
  turn that failed or was cancelled may already have run `workflow step start` (mutating
  `workflow_progress`/`change.yaml`) and left source files dirty, with `finishStep` never
  invoked; a turn reported "completed" may correspond to a `finishStep` invocation that itself
  never fully settled (its own durable finish-operation record still `running`). Releasing the
  claim in either case admits the next writer (a queued human-submit, Publish, Batch Publish,
  or the next automatically-dispatched agent execution) onto worktree state nobody has
  finished with or accounted for.
- **Decision:** Introduce **execution settlement**, a concept distinct from and strictly
  downstream of "AI/session turn terminal." A workspace-writing execution (agent-kind or the
  new `cli-manual` kind, D62) passes through four explicit states:
  - **active** — the claim is held and the execution is still genuinely in progress.
  - **terminal-unsettled** — the AI/session turn (or CLI invocation) has ended, but settlement
    has not yet been established.
  - **settled** — settlement is proven (D60); the claim may be released.
  - **recovery-required** — reconciliation attempted to establish settlement and could not;
    the claim is retained, unreleased, and blocks every subsequent writer until an
    owner/operator resolves it (D61).
  Turn-terminal (or CLI-process-exit) is only the trigger to *attempt* the active →
  terminal-unsettled transition and immediately run the settlement check (D60) — it is never
  itself sufficient to release the claim. Only a proven `settled` outcome releases the claim;
  anything else moves to `recovery-required` rather than releasing.
- **Rationale:** Matches the brief precisely: the workspace-writer slot exists to protect the
  physical worktree, not to mirror the AI turn's own lifecycle; equating "turn terminal" with
  "workspace releasable" was the exact bug the brief identifies. A fail-closed default
  (`recovery-required`, not release) prevents ever silently exposing an unreconciled dirty
  worktree to the next writer.
- **Consequences:** `automatic-workflow-continuation` (task 29)'s Hook 1 (per-turn
  subscription) and Hook 3 (boot-time orphaned-turn reconciliation) no longer call
  `forceReleaseWorkspaceWriter` directly on terminal/orphan detection — they first run the
  settlement check (D60) and only release on a proven-settled result, else mark
  `recovery-required` (D61).
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `areas/dependency-release-and-invalidation.md`, `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/29-automatic-workflow-continuation.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D60: Execution settlement is defined concretely from existing durable/ownership primitives — never a raw `git status` check

- **Question:** "Safe to release" cannot be left as implementation intuition, and must not be
  simply "git status is clean" — unrelated, pre-existing user changes may already be dirty in
  the worktree for reasons that have nothing to do with the execution being reconciled, and
  the system already has ownership/scope concepts that know the difference.
- **Decision:** A new function, `assessExecutionSettlement({repoRoot, changeSlug, taskId})`
  (`tools/specs/workflow/execution-settlement.mjs`, new file, task 27), resolves the task's
  current attempt and reports `settled` only when **all** of the following hold — each
  checked via an already-existing primitive, never re-derived or newly invented:
  1. No in-flight `workflow-start-operations/<change>/<task>/**` record remains for that task
     (`findInFlightStartOperation`, `start-operation.mjs`, D52).
  2. No in-flight finish-operation record remains for that task (`findInFlightOperationRecord`,
     `operation-record.mjs`, D50).
  3. The task's current `workflow_progress` position for the attempt this execution owns is
     **not** `active` — an active position with no in-flight finish-operation means
     `finishStep` was simply never invoked for a mutation `workflow step start` already made;
     this alone is decisive and is checked before any file-content inspection.
  4. No dirty tracked change remains within this execution's own **owned scope** — the same
     scope `resolveTaskScope`'s `allowedPaths` and `resolveWorkflowOwnedPaths`
     (`step-context.mjs`, `commit-and-push.mjs`) already compute for
     `OUT_OF_SCOPE_WORKTREE_CHANGES` detection, inverted: here, checking whether the *in-scope*
     paths are dirty, not whether out-of-scope paths are. A dirty file entirely outside this
     execution's own owned scope (e.g. a human operator's unrelated, pre-existing edit) never
     blocks settlement — only dirt attributable to this execution's own scope does.
  Any of these failing → not settled (`recovery-required`, D61) — never a partial or
  best-effort release.
- **Rationale:** Every fact used already exists and is already the system's own definition of
  "this execution's business" — reusing it means settlement can never disagree with what
  `finishStep`/`workflow step start`/the scope-enforcement machinery themselves already
  believe, and avoids inventing a second, competing notion of "dirty."
- **Consequences:** task 27 gains one new small file (`execution-settlement.mjs`), importing
  from `start-operation.mjs`/`operation-record.mjs`/`step-context.mjs` (import-only) and its
  own `workspace-writer.mjs`. Task 29 imports (never edits) it for Hooks 1/3 (agent-kind);
  task 27's own `cli.mjs` wrapper imports it for the `cli-manual` kind (D62).
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tasks/29-automatic-workflow-continuation.md`,
  `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D61: Reconciliation must assess settlement before releasing an ambiguous claim; `forceReleaseWorkspaceWriter` is constrained to already-proven-safe callers, never the default recovery path

- **Question:** D56's boot-time orphaned-turn reconciliation currently calls
  `forceReleaseWorkspaceWriter` unconditionally whenever it finds a persisted `activeTurn`
  left behind by an ungraceful restart. That is unsafe precisely when the orphaned execution
  left dirty, un-finalized state behind — the exact case D59/D60 now define.
- **Decision:** Every reconciliation path that used to call `forceReleaseWorkspaceWriter` on a
  terminal/orphaned agent-kind claim (Hook 1's per-turn subscription, Hook 3's boot-time orphan
  detection) now calls `assessExecutionSettlement` (D60) first:
  - **settled** → call `forceReleaseWorkspaceWriter` (unchanged mechanism) — this remains the
    *only* legitimate caller of that function for an ambiguous/orphaned agent claim.
  - **not settled, but canonical session/turn state shows the execution is still genuinely,
    actively running** (a false alarm — not actually orphaned) → no action; the claim
    correctly stays `active`.
  - **not settled, and genuinely orphaned/terminal** → a new function,
    `markWorkspaceWriterRecoveryRequired` (`workspace-writer.mjs`, task 27), flips the claim's
    persisted `status` to `recovery-required` **without deleting it**. The claim stays held,
    blocking every subsequent writer.
  `forceReleaseWorkspaceWriter` itself gains no new internal safety logic (it stays an
  unconditional, mechanical delete) — the constraint is enforced entirely at the call site: it
  is documented as callable **only** once a caller has already established settlement (or, for
  the `kind !== 'agent'` pid-mismatch case D56 already covers, genuine unconditional
  process-lifetime staleness — unchanged) — never as a blind "clean up an ambiguous owner"
  default. A workspace-writer record whose `status` is `recovery-required` is never
  auto-reclaimed by anything — not by another kind's pid-staleness check, not by a later
  boot-time pass finding yet another mismatch. It is cleared only by an explicit,
  out-of-scope-for-this-pass reconciliation action (a human operator or a future dedicated
  recovery task inspecting and resolving the underlying dirty state) — this pass defines the
  state and its blocking behavior, not its resolution workflow. No auto-clean, auto-stash, or
  auto-discard of any file is ever performed by this reconciliation.
- **Rationale:** Matches the brief precisely — fail closed, no auto-clean/stash/discard,
  `forceReleaseWorkspaceWriter` is not the normal recovery operation for an ambiguous owner,
  and ambiguity always surfaces as an explicit, blocking `recovery-required` state rather than
  a silent release.
- **Consequences:** `workspace-writer.mjs` gains `markWorkspaceWriterRecoveryRequired` and a
  `status` field on its record; `acquireWorkspaceWriter` treats an existing
  `recovery-required` record as an unconditional block (a plain, mechanical status-field
  check, not a liveness judgment) and reports it distinguishably to the caller (D67). Task 29's
  Hooks 1/3 are the only call sites invoking this reconciliation sequence for agent-kind
  claims; task 27's own `cli.mjs` wrapper invokes the symmetric sequence for `cli-manual`
  claims (D62).
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `areas/dependency-release-and-invalidation.md`, `tasks/27-dependency-release-and-invalidation.md`,
  `tasks/29-automatic-workflow-continuation.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D62: Workspace-writer arbitration covers every deterministic tracked-mutation entry point, including the CLI — a new `cli-manual` kind for direct invocation outside dashboard orchestration

- **Question:** `workflow step start`/`workflow step finish` are public deterministic CLI
  commands, independent of the dashboard. A correctness invariant cannot depend on the caller
  having come through `admitAgentExecution`. Today a raw/manual CLI invocation of
  `workflow step start` mutates `workflow_progress`/`change.yaml` (via `ensureStepActivated`,
  inside `compileStepContext`) with no workspace-writer claim at all — indistinguishable, from
  the worktree's point of view, from the exact hazard D55 exists to prevent, just reached from
  a different caller.
- **Decision:** All deterministic tracked-workspace mutations participate in the same
  workspace-writer protocol — one canonical rule, no dashboard/CLI split in safety semantics.
  `cli.mjs`'s `handleWorkflowStepStart` (task 27, already an allowed path) wraps its own call
  to `compileStepContext` (the actual mutation point, via `ensureStepActivated`) whenever the
  resolved position is non-terminal (a mutation will actually occur):
  1. **If an existing claim already covers this exact spec/task/attempt** (a
     dashboard-orchestrated `agent`-kind claim whose recorded `taskId` matches — this CLI
     process is itself one of that execution's own tool-call subprocesses) — proceed without
     acquiring a second claim; the existing claim already protects this exact mutation (D55's
     "held for the whole execution").
  2. **Otherwise** — attempt to acquire the workspace-writer slot with a new
     `kind: 'cli-manual'`, waiting/failing per the same arbitration rules as any other kind
     (D66). Before waiting on a pre-existing `agent`/`cli-manual` claim found here, this same
     `cli.mjs` wrapper first attempts settlement-based reconciliation of that pre-existing
     claim via `assessExecutionSettlement` (D60/D61) — symmetric to how task 29's Hooks 1/3 do
     the same for agent-kind claims — since there is no CLI "boot" event to hang a
     reconciliation pass off of; reconciliation is attempted lazily, at the next acquisition
     attempt. `workspace-writer.mjs`'s own `acquireWorkspaceWriter` remains mechanism-only and
     never attempts settlement checking on its own initiative (D55/D56 unchanged) beyond the
     one purely-mechanical check of an existing record's persisted `status` field being
     `recovery-required`, which requires no liveness judgment at all.
  `handleWorkflowStepFinish` (also task 27's file) checks whether the currently-held claim is
  `kind: 'cli-manual'` and belongs to this same task/attempt; if so, once `finishStep` returns
  successfully (commit landed — settlement is trivially proven synchronously, in-process, no
  async reconciliation needed for this path), it releases that claim immediately, in the same
  process. A `cli-manual` claim left behind by a crashed/abandoned CLI process (no matching
  `workflow step finish` ever ran) is reconciled the same way any other ambiguous claim is
  (D61), attempted the next time *any* caller tries to acquire the slot and finds the existing
  `cli-manual` record.
- **Rationale:** Matches the brief precisely — one canonical rule, not two safety models; the
  manual/CLI case reuses the exact same settlement definition (D60) as the
  dashboard-orchestrated agent case, since both ultimately go through the identical
  `ensureStepActivated`/`finishStep` engine primitives — only the caller and the claim's
  `kind`/identity fields differ.
- **Consequences:** `cli.mjs`'s `handleWorkflowStepStart`/`handleWorkflowStepFinish` gain this
  wrapping logic (task 27); no change to their existing return contracts/CLI UX.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D63: `workflow verify-human`'s CLI human-decision path delegates to the same combined `activateAndSubmitHumanStep` operation the dashboard uses

- **Question:** `cli.mjs`'s `handleWorkflowVerifyHuman` (its `--approve`/`--request-changes`
  branch) currently calls `startHumanStep` then `submitHumanStepResult` directly — the exact
  legacy two-step shape D47 already replaced for the dashboard with the combined,
  workspace-writer-and-git-finalize-lease-protected `activateAndSubmitHumanStep`. Left as-is,
  the CLI retains a second, arbitration-free path to the identical mutation, defeating D55's
  own invariant the moment anyone runs this command directly (a human operator, a test, a
  script) while an agent execution is active.
- **Decision:** `handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch calls
  `activateAndSubmitHumanStep` (`human-step/operations.mjs`, task 29) instead of
  `startHumanStep`/`submitHumanStepResult` directly — one implementation, two callers
  (dashboard's `human-step-transport.mjs`, and now the CLI). Its `--confirm` branch (writing a
  `FileHumanVerificationStore` signoff record — untracked, `.nevo-ai-local`-local state, not a
  `workflow_progress`/`change.yaml` mutation) is unaffected and needs no workspace-writer
  claim, preserving "`HumanStepSurface` preview is mutation-free" exactly as today. CLI UX
  (flags, output shape, error messages) is preserved unchanged — only the internal call graph
  changes.
- **Rationale:** One correctness implementation, not two; matches the brief precisely.
- **Consequences:** `automatic-workflow-continuation` (task 29) gains
  `tools/specs/workflow/cli.mjs` in its `allowed_paths` (shared with task 27 — task 27 owns
  `handleWorkflowStepStart`/`handleWorkflowStepFinish`'s workspace-writer wrapping (D62) and
  its own pre-existing dependency-consumption call-site insertion (D52/D53); task 29 owns only
  `handleWorkflowVerifyHuman`'s delegation to `activateAndSubmitHumanStep` — each task's own
  out-of-scope section names the other's exact function boundary so neither treats the whole
  file as its own).
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tasks/29-automatic-workflow-continuation.md`,
  `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D64: `publishTask()` itself — not merely its callers — owns workspace-writer and git-finalize arbitration

- **Question:** The workspace-writer invariant must hold regardless of whether Publish is
  reached from the dashboard route, the CLI (`workflow task publish`), or a direct domain call
  (tests/tools). Placing the `acquireWorkspaceWriter`/`withGitFinalizeLock` sequence only in
  the dashboard's route handler would leave the CLI and any direct caller of `publishTask()`
  completely unprotected — the identical class of gap D62 just closed for `workflow step
  start`.
- **Decision:** `publishTask()` itself (`tools/specs/workflow/publish/operation.mjs`, task 31
  — the one function both `cli.mjs`'s `handleWorkflowTaskPublish` and the dashboard's Publish
  route call identically) acquires the workspace-writer slot (`kind: 'publish'`) and the
  nested git-finalize lease around its own mutate-then-commit sequence, exactly as already
  planned (D55/D56) — this decision only makes explicit *where*: inside the shared domain
  function, never only in one caller. Batch Publish remains the one dashboard-only exception:
  its atomic multi-task record lives in `handleBatchPublish` (`routes.mjs`, no CLI equivalent
  exists), so its `kind: 'batch-publish'` workspace-writer claim is acquired there, around the
  whole prevalidate-then-mutate-then-commit sequence, not inside per-task `publishTask()` calls
  it may reuse internally for prevalidation logic only.
- **Rationale:** Matches the brief precisely — put safety at the lowest sensible shared
  domain/application boundary; a caller-side-only safeguard is exactly the kind of gap this
  whole spec exists to close (the original dogfooding incident was precisely a caller
  forgetting to protect a shared mutation).
- **Consequences:** task 31's own implementation constraints are clarified (no behavior change
  from pass 14's plan — this decision states explicitly which function owns the acquisition,
  since the prior wording was ambiguous between "the Publish path" and the `publishTask()`
  function specifically).
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/user-mutation-source-control-ownership.md`,
  `tasks/31-user-mutation-source-control-finalization.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D65: Workspace-writer identity is keyed by the physical worktree, matching the git-finalize lease's own already-correct convention — never by `specId`

- **Question:** `.nevo-ai-local/workspace-writers/<specId>.json` (D56) allows two different
  specs in the *same* physical repository checkout to each acquire their own, independent
  workspace-writer record — defeating the entire purpose of protecting the one shared worktree
  the moment more than one spec is active in it (already true today: this very repository
  routinely has many active specs under `specs/active/**` sharing one checkout). An agent
  execution for spec A and a Publish for spec B would arbitrate against each other not at all,
  while both mutate the same physical files.
- **Decision:** The workspace-writer record is keyed by the physical worktree, not by
  `specId` — one single, well-known file per checkout, mirroring `git-finalize-lock.mjs`'s own
  already-correct convention (`.nevo-ai-local/locks/git-finalize.lock`, no `specId` in its
  path, already scoped to the whole worktree since `.nevo-ai-local` itself lives at the repo
  root). Corrected path: `.nevo-ai-local/locks/workspace-writer.lock` (same directory as its
  sibling git-finalize lock, both worktree-scoped, both `.nevo-ai-local`-local-runtime files).
  The record body still carries `specId`/`taskId`/`sessionId`/`turnId` for attribution and for
  the caller-side reconciliation logic (D60–D62) — these fields identify *who* holds the
  claim, they are never used to compute *where* the claim is stored. Acquisition/contention is
  therefore now correctly **cross-spec**: an agent execution for spec A and a Publish for spec
  B, sharing one worktree, now correctly serialize against each other via this one shared
  claim.
- **Rationale:** Matches the brief precisely; reuses an already-accepted, already-correct
  sibling primitive's own convention rather than inventing a new identity scheme (a realpath
  hash, a worktree-id file, etc.) that this single-checkout-per-server architecture does not
  need.
- **Consequences:** `dependency-release-and-invalidation` (task 27)'s `workspace-writer.mjs`
  record path changes; D55/D56's own "for one specification, at most one workspace writer"
  phrasing is corrected to "for one physical worktree" — D33/D41/D49's own, separate,
  unchanged invariant ("one agent-owned execution per specification") still governs agent
  admission specifically and is not affected. Every area doc's "cross-spec workspace-writer
  arbitration: out of scope" line is corrected — cross-spec arbitration is now the explicit,
  required behavior, not an exclusion.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `areas/workflow-continuation-and-session-handover.md`,
  `areas/user-mutation-source-control-ownership.md`,
  `tasks/27-dependency-release-and-invalidation.md`, `tasks/29-automatic-workflow-continuation.md`,
  `tasks/31-user-mutation-source-control-finalization.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D66: Canonical lock-acquisition ordering across the admission mutex and the workspace-writer claim, applied identically by every caller

- **Question:** `admitAgentExecution` must atomically ensure both "one agent execution per
  spec" (D41/D49) and "one workspace writer per physical worktree" (D65) while avoiding any
  possibility of two coordination primitives deadlocking against each other.
- **Decision:** One fixed ordering, used by every caller, no exceptions:
  1. Spec-level admission mutex (agent-only; D41/D49's own in-process, per-`specId`
     promise-chain mutex) — acquired first, and **only** by the agent-execution-creation path.
     No other kind (`human-submit`, `publish`, `batch-publish`, `cli-manual`) ever acquires
     this mutex at all.
  2. Workspace-writer claim (D65, per-physical-worktree) — acquired second by the agent path
     (immediately after the admission mutex, before session/turn creation begins); acquired
     **first and only** (no admission mutex involved) by every non-agent path.
  3. Session/turn creation proceeds (agent path only).
  4. Durable visibility confirmed (agent path only).
  5. Admission mutex released (agent path only) — short-lived, released as soon as durable
     visibility is confirmed.
  6. Workspace-writer claim retained until settlement (D59) — held for the agent path's entire
     execution lifetime; held for a non-agent path only around that operation's own short,
     self-contained duration.
  Because the admission mutex is acquired by exactly one path (agent) and always before the
  workspace-writer claim on that same path, and no other path ever touches the admission
  mutex, no cycle can form: nothing ever waits for the workspace-writer claim while holding the
  admission mutex in the reverse order, and nothing ever waits for the admission mutex while
  holding the workspace-writer claim. **Rollback on failure:** if session/turn creation fails
  after both claims are held but before durable visibility, both are released together, in the
  same failure path, in the reverse of acquisition order (workspace-writer claim, then
  admission mutex) — unchanged from D56's own existing rollback description, now stated as the
  general rule every future workspace-writing operation's own failure path must follow.
- **Rationale:** Matches the brief precisely — one documented ordering removes any need to
  reason about deadlock case-by-case; the ordering is exactly what D41/D49/D55/D56 already
  implied informally, this decision only makes it an explicit, binding rule for all present and
  future callers.
- **Consequences:** No implementation change beyond what D55/D56/D59 already require — this
  decision is a documentation/binding-rule correction, closing the risk of a future caller
  (e.g. a not-yet-designed workspace-writing operation) inventing a different, conflicting
  order.
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/29-automatic-workflow-continuation.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.

## D67: A pending user-submitted workspace mutation's wait is a durable, request-level status, distinct from and outliving the low-level bounded acquisition-retry timeout

- **Question:** `acquireWorkspaceWriter`'s own internal bounded retry/backoff timeout (task
  27's own existing description: "a bounded — generously long — timeout") exists as a safety
  valve against a genuinely stuck acquisition attempt. If that internal timeout is allowed to
  surface directly as the outcome of a user-submitted Approve/Publish/Batch-Publish request, a
  perfectly valid pending user intent would fail outright merely because the currently-active
  agent execution happened to run long, or (per D59–D61) entered `recovery-required`.
- **Decision:** Two distinct concepts, never conflated:
  - **Low-level acquisition timeout** (`acquireWorkspaceWriter`'s own internal bound) — an
    implementation safety valve only; never surfaced directly as a user-facing failure.
  - **Request-level waiting status** — the durable user-submitted operation (Publish's own
    already-durable intent record, D29; Batch Publish's own record; a human-submit request)
    reports one of two distinct, explicit statuses whenever it has not yet begun its own
    tracked mutation: **`waiting-for-workspace`** (ordinary contention — another kind or an
    active agent currently holds the claim) or **`blocked-by-recovery`** (the existing claim's
    persisted `status` is `recovery-required`, D61). A request in either status is never
    silently dropped or failed by the passage of time alone; the calling operation
    retries/re-attempts acquisition transparently across any number of internal low-level
    timeout cycles, remaining `waiting-for-workspace`/`blocked-by-recovery` at the request
    level until the slot is actually free (or, for `blocked-by-recovery`, until an
    out-of-scope-for-this-pass reconciliation action clears the `recovery-required` claim).
    This status is surfaced to the dashboard/API layer as a distinct, named state — never
    reported as a generic error.
- **Rationale:** Matches the brief precisely — differentiate request-waiting semantics from
  low-level lock-acquisition timeout; a durable user intent should survive waiting where
  appropriate, never converted into an arbitrary failure by an unrelated, long-running agent
  turn.
- **Consequences:** `automatic-workflow-continuation` (task 29, human-submit) and
  `user-mutation-source-control-finalization` (task 31, Publish/Batch Publish) both surface
  this two-value status distinctly wherever they already report a pending operation's state;
  neither introduces a new durable operation-record stage for it (a lightweight status
  surface, not a new stage in the existing `validate/update-task/commit/push`-style stage
  machine).
- **Date:** 2026-09-22
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `areas/user-mutation-source-control-ownership.md`, `tasks/29-automatic-workflow-continuation.md`,
  `tasks/31-user-mutation-source-control-finalization.md`, `tasks/33-orchestration-e2e-dogfood-tests.md`.
