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
  policy already exist for this task/provider?" If not, and the provider's permission model
  needs an explicit mode, show the selection UI instead of creating a session directly. Exact
  persistence location (session store vs. a new sidecar) is an implementation detail for
  `areas/workflow-continuation-and-session-handover.md`'s owning task, not decided here.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/25-execution-policy-and-mode-selection.md`.

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
  filtered by routing inference. At minimum it carries canonical, repo-root-relative paths;
  bundling each document's content inline (so the agent needs zero extra discovery/read calls)
  is the preferred shape and must be evaluated against payload-size impact during
  implementation, not decided as unconditional here. `relevantDocs` is unchanged in meaning
  and computation (routing-derived repository rules/instructions) and stays a separate field
  — neither field replaces the other.
- **Rationale:** Matches the corrective-pass brief exactly: "Model two different concepts
  explicitly... They are not interchangeable."
- **Consequences:** `agent-step-bootstrap-and-context` (task 24) reuses the existing
  frontmatter-loading path (`loadTaskFrontMatter`/`parseFrontMatterFile`, already used by
  `buildContextPacket()`) rather than re-deriving `context.required` a second way.
- **Date:** 2026-09-21
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
  `standard-v1.yaml`'s `implementation → review` transition is the first candidate for
  `continueOnSuccess: auto`; whether it should actually be set that way (vs. left
  `owner-action`) is an implementation-time judgment against this decision's schema, not
  fixed here.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/26-workflow-continuation-schema.md`, `tasks/27-automatic-workflow-continuation.md`.

## D26: Declarative session-reuse policy, session lineage, and execution role — review uses a fresh session

- **Question:** Session selection for starting a step currently matches only on `taskId`
  (`binding-service.mjs`'s `listSessions`/`listSessionsSync`, confirmed by reading the filter
  directly) — `binding.step` exists but is never used as a selection filter, so review can
  silently reuse the implementer's own conversational session. No `parentSessionId`/session-
  lineage or execution-role concept exists anywhere in `tools/dashboard/server/ai/**`
  (confirmed absent by grep). How should "independent reviewer" be modeled without requiring a
  different provider and without deriving it from a literal step name?
- **Decision:** A declarative `sessionPolicy: reuse | fresh` field on a step (or, if cleaner
  during implementation, on the transition entering it) determines whether the orchestrator
  (D25) reuses the previous step's session or creates a fresh one. `standard-v1.yaml`'s
  `review` step is set to `fresh`. A fresh session records `parentSessionId` — a new lineage
  field on the existing canonical session identity (alongside `sessionId`,
  `activeTaskId`/`taskIds`) — pointing at the session it followed, so lineage is queryable
  without inventing a second identity system. An execution-role concept
  (`role: implementer | reviewer | refiner`, extensible) is added to session identity,
  assigned by the orchestrator from the *step's* own execution semantics (never derived from
  a literal step id/name — e.g. `standard-v1`'s `human-verification`'s agent-owned
  "request-changes" handover would use `role: refiner`, decided by the transition's own
  declared handover target, not by string-matching `'human-verification'`). "Independent
  reviewer" means a fresh session/execution context; provider/model selection stays the
  separate policy D21 already governs.
- **Rationale:** Matches the brief precisely: reuse the existing canonical session identity
  for lineage rather than a new one; support at least reuse/fresh; assign roles from
  declared semantics, never step-name derivation; independence is about session freshness,
  not a forced provider change.
- **Consequences:** `listSessions`/`listSessionsSync`'s `taskId`-only filter is unaffected by
  this decision (still correct for "show me every session touching this task" — a UI listing
  concern); the orchestrator's own "which session do I hand off to" decision is a separate,
  new consumer of `sessionPolicy`/`parentSessionId`/`role`, not a change to the existing list
  filter's semantics.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/26-workflow-continuation-schema.md`, `tasks/27-automatic-workflow-continuation.md`.

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
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/workflow-continuation-and-session-handover.md`,
  `tasks/27-automatic-workflow-continuation.md`.

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
- **Consequences:** `standard-v1.yaml`'s `implementation → review` transition is the natural
  candidate to mark `releasesDependencies: true` (matching the corrective-pass brief's own
  example); doing so is an implementation-time judgment against this schema, not fixed here.
  This decision covers only the release point — the invalidation consequence when a released
  dependency's later review fails is OQ-A, open, not decided by this entry.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/dependency-release-and-invalidation.md`,
  `tasks/26-workflow-continuation-schema.md`, `tasks/28-dependency-release-and-invalidation.md`.

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
  lifecycle action. The operation reuses the existing, already-registered `commit-and-push`
  action (`defaultActionRegistry.require('commit-and-push')`, the same one `finish-operation.mjs`
  already calls) rather than a second Git implementation. Crash/resume semantics follow the
  same pattern that action already provides for `finishStep`'s own multi-stage
  mutate-then-finalize sequence — no new crash-recovery mechanism is invented for Publish
  specifically.
- **Rationale:** Matches the brief's stated principle directly: "a user action that
  independently completes a Git-tracked lifecycle mutation must own the source-control
  finalization of that mutation." Reusing the existing action avoids duplicating Git
  implementation and inherits its already-proven crash-safety properties.
- **Consequences:** Publish's clean-worktree guarantee is preserved (the brief's explicit
  "do not weaken" constraint) — if `commit-and-push` fails after the mutation, the worktree is
  left exactly as dirty as any other action's own failure mode leaves it today, not worse.
- **Date:** 2026-09-21
- **Affected artifacts:** `areas/user-mutation-source-control-ownership.md`,
  `tasks/30-user-mutation-source-control-finalization.md`.

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
  `tasks/30-user-mutation-source-control-finalization.md`.
