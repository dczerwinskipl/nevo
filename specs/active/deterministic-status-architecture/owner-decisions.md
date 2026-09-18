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

- **Question:** When `workflow step start`/`workflow step finish`/`workflow verify-human`
  omit the task id, what should replace today's fallback to legacy
  `status === 'in-implementation'` (`resolveDefaultTask` in `tools/specs/workflow/cli.mjs`)?
- **Options considered:** (a) require an explicit task id always; (b) model a new
  deterministic "active/in-flight" concept derived purely from `workflow_progress` across
  the change's tasks.
- **Decision:** (a) — require an explicit task id for deterministic commands. Drop the
  legacy-status fallback without replacing it with new state.
- **Rationale:** Matches the change's own "out of scope: new permanent task authoring
  state model unless necessary" — option (b) is a real future improvement but not
  necessary to remove the legacy-status reliance the brief targets.
- **Consequences:** `workflow step start <change>` / `workflow step finish <change>` /
  `workflow verify-human <change>` without a task id now error clearly instead of
  guessing. Revisit if this proves too inconvenient in practice.
- **Date:** 2026-09-17
- **Affected artifacts:** `tasks/05-deterministic-cli-default-task-resolution.md`.

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
- **Affected artifacts:** `tasks/19-ownership-boundary-documentation.md`.

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
- **Decision:** (b) — corrective pass, this decision record. The deterministic flow this
  change targets was never exercised through a full end-to-end test before this
  correction; the owner directed dropping compatibility with whatever the first attempt
  had already built and correcting the architecture before any implementation starts,
  while continuing to fully support the legacy flow unchanged in the meantime.
- **Rationale:** A literal step-name check is exactly the kind of hardcoded coupling this
  whole change exists to remove elsewhere (`stageForStatus`, `isTaskReady`) — reintroducing
  it for human review specifically would be inconsistent. A generic `executor` property is
  also the natural place to enforce "an agent must never execute a human-owned step and
  vice versa" as an invariant, not just a UI convention.
- **Consequences:** The former `human-interaction-projection` design (`kind: 'verification'
  | 'decision'`) is replaced by `human-step-projection` (D5, `{step: {id, executor,
  purpose, expectedWork}, actions: [...], artifacts?}`). `entryGates`/`exitGates` remain
  unchanged as a separate mechanism. This is a pre-implementation correction — no
  implementation code built on the old design is being migrated; the earlier task set
  (`human-interaction-projection`, etc.) is replaced outright, not extended.
- **Date:** 2026-09-18
- **Affected artifacts:** `areas/deterministic-projection-and-human-step.md`,
  `areas/step-executor-model.md`, `tasks/06-*` through `tasks/10-*`, `tasks/17-*`.

## D6: Workflow-definition schema gets one bounded, migrated extension

- **Question:** How does `executor`, transition `action` metadata (label/feedback), and a
  terminal-step success/failure `outcome` reach existing workflow definitions
  (`.nevo-ai/workflows/*.yaml`) — an implicit default inferred at read time, or an explicit,
  small, one-time migration of the existing five definition files?
- **Decision:** Explicit, bounded migration of the existing definition files, done once as
  part of `workflow-definition-schema-extensions` (task 06) — not an inferred default for
  the specific steps that need `executor: human`/`outcome: success` today (their
  human-owned/success-terminal step(s) are named explicitly in each file). A default of
  `executor: agent` when the field is entirely absent is still reasonable for steps that
  are unambiguously agent-executed, so the migration only needs to touch each definition's
  human-owned and terminal step(s), not every step.
- **Rationale:** An inferred default for the *human* case specifically would silently
  assume "agent" unless a step happens to be named a certain way — reintroducing exactly
  the name-based coupling D5 removes. The terminal-outcome field needs the same treatment
  for the same reason (item 13: do not infer "success" from the step being named
  `verified`).
- **Consequences:** Task 06 touches `.nevo-ai/workflows/*.yaml` directly, in addition to
  `tools/specs/workflow/definitions/{loader,schema}.mjs`. This is the one place in this
  change that edits data files outside `tools/specs/**`/`tools/dashboard/**` proper.
- **Date:** 2026-09-18
- **Affected artifacts:** `areas/step-executor-model.md`, `tasks/06-workflow-definition-schema-extensions.md`.

## D7: Human review surface consolidation — shared component, not a chat→dialog redirect

- **Question:** Chat already renders its own Approve/Request-changes UI
  (`AgentSessionChatSurface`/`AgentSessionWorkflowBar`). Should the new reusable
  human-step surface replace that in place (both call sites render the same component), or
  should chat instead navigate/open `TaskDialog` to show it?
- **Decision:** Shared component, rendered directly by both `TaskDialog` and the existing
  chat surface — not a navigation redirect.
- **Rationale:** Chat's in-place review affordance is existing, working UX; forcing a
  navigation away from chat to approve/request changes would be a regression, not a
  consolidation. A shared component achieves "one implementation" without that UX cost.
- **Consequences:** `human-review-surface-consolidation` (task 17) touches both
  `task-dialog.tsx` and the chat surface files, replacing chat's existing separate
  implementation with the shared component rather than leaving it as a second one.
- **Date:** 2026-09-18
- **Affected artifacts:** `areas/human-review-surface.md`, `tasks/17-human-review-surface-consolidation.md`.

## D8: Import boundary tightened — no blanket exemption for `lifecycle-primitives.mjs`

- **Question:** Should `tools/specs/lifecycle-primitives.mjs` remain a blanket-exempt
  "shared low-level utility" importable by deterministic mutation/projection code (as
  originally recorded), given it actually contains legacy-specific concepts (`isTaskReady`,
  `DEPENDENCY_SATISFYING_STATUSES`, `TRANSITIONS`, `TERMINAL_STATUSES`)?
- **Decision:** No. Only `resolveWorkflowMode()` (`tools/specs/workflow/compatibility.mjs`)
  and the generic, semantics-free store writers (`setTaskStatus`/`setTaskWorkflowState` in
  `tools/specs/store.mjs`) are shared/exempt. `lifecycle-primitives.mjs` itself is
  off-limits to deterministic mutation and projection code — if a deterministic module
  needs a truly lifecycle-neutral helper that happens to live there today, it is extracted
  to a neutral location, not imported from that file.
- **Rationale:** Item 14 of the corrective pass — the previous exemption would have let
  deterministic code silently depend on legacy status semantics through the back door,
  defeating the point of `deterministic-dependency-satisfaction` (task 09) existing as a
  separate, legacy-independent implementation.
- **Consequences:** `lifecycle-boundary-regression-tests` (task 03)'s import-boundary check
  now flags any import of `tools/specs/lifecycle-primitives.mjs` from deterministic
  mutation/projection code as a violation, not just imports of the four legacy mutation
  command folders.
- **Date:** 2026-09-18
- **Affected artifacts:** `areas/lifecycle-boundary-guards.md`, `tasks/03-lifecycle-boundary-regression-tests.md`.

## D9: Deterministic "successful terminal" is an explicit per-step field, not inferred

- **Question:** How does dependency satisfaction distinguish a workflow's successful
  terminal outcome from any other terminal outcome (e.g. an abandoned/failed terminal),
  without reusing legacy status semantics or hardcoding a step name?
- **Decision:** An explicit `outcome: success | failure` field on a workflow definition's
  terminal step(s) (a step with no outgoing `transitions`), set by the migration in task 06.
  The shipped `standard`/`architectural`/etc. definitions' existing `verified`-equivalent
  terminal step is marked `outcome: success`; any other terminal step a definition defines
  is marked `outcome: failure` unless a future definition states otherwise.
- **Rationale:** Item 13 explicitly forbids leaving "successful terminal" undefined or
  inferring it from legacy status vocabulary or a step being named a certain way.
- **Consequences:** `deterministic-dependency-satisfaction` (task 09) reads this field,
  not the step's name and not legacy `TERMINAL_STATUSES`/`DEPENDENCY_SATISFYING_STATUSES`.
  This is deliberately the smallest addition that makes the concept explicit — not a full
  terminal/outcome model redesign (multiple named outcomes, retry semantics, etc. remain
  out of scope).
- **Date:** 2026-09-18
- **Affected artifacts:** `areas/step-executor-model.md` (schema),
  `areas/deterministic-projection-and-human-step.md` (consumer),
  `tasks/06-workflow-definition-schema-extensions.md`,
  `tasks/09-deterministic-dependency-satisfaction.md`.

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
