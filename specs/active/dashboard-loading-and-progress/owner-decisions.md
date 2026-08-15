# Owner decisions — dashboard-loading-and-progress

## D1: Path-pattern matching dependency for Changes grouping/generated-file config

- **Question:** `changeView.groups` and `generatedFiles` config need to match file paths
  against glob patterns (`**`, `*`, literal segments). No glob-matching library is a
  direct dependency today (`picomatch` is only a transitive dependency inside
  `tools/dashboard/package-lock.json`). Add a new direct dependency, or hand-roll a
  minimal matcher?
- **Options considered:** (A) hand-rolled minimal `matchPath` utility scoped to `**`/`*`/
  literal segments | (B) add `picomatch` as a new direct dependency of
  `tools/dashboard`. Full option analysis (trade-off dimensions, sizing, consequences):
  `solution-options.md`.
- **Decision:** (B) — add `picomatch` as a new direct dependency.
- **Rationale:** not stated beyond selecting the option.
- **Consequences:** `tools/dashboard/package.json` gains `picomatch` under
  `dependencies`; the changes-grouping area implements path matching by calling
  `picomatch` directly rather than a hand-rolled matcher. No fallback matcher needed.
- **Date:** 2026-08-15
- **Affected artifacts:** `areas/changes-grouping-and-filtering.md`,
  `tasks/03-changes-grouping-and-filtering.md`

## D2: Scope of operation-progress wiring in this change

- **Question:** The Operation/Steps progress model applies to gate checks, spec
  verification, implementation verification, AI verification, task acceptance, batch
  verification, test runs, and final audits. Build the contract + UI and wire only one
  reference operation now (rest as fast-follow), or wire all of them in this change?
- **Options considered:** (A) contract + UI + one reference operation (task
  verification) now, rest documented as a mechanical fast-follow pattern | (B) contract +
  UI + all listed operation kinds wired in this change.
- **Decision:** (B) — wire all applicable existing multi-step CLI operations in this
  change **(wording precision, 2026-08-15 — corrected from "all listed operation
  kinds").** The original phrasing, read literally against the overview's list (gate
  checks, spec verification, implementation verification, AI verification, task
  acceptance, batch verification, test runs, final audits), could be misread as a
  mandate to fabricate an `Operation`/step for every named item even where no real,
  separable CLI-subprocess operation exists for it — exactly what task 06's own "confirm
  before instrumenting, never fabricate" constraint and
  `areas/operation-progress-contract.md`'s own "never invent artificial steps"
  constraint already forbid. Scope is unchanged by this reword: every operation kind
  that is a real, existing multi-step CLI/subprocess operation still gets wired; a
  listed kind with no such real operation is named explicitly as not applicable (task
  06's own reporting requirement), never silently skipped and never fabricated.
- **Rationale:** not stated beyond selecting the option (wording-precision rationale,
  owner-stated, 2026-08-15: align D2's own text with the "never invent artificial
  steps/operations" constraint stated elsewhere in this change, which the original
  phrasing appeared to contradict).
- **Consequences:** the operation-progress area is split into more than one task
  (contract/transport, then CLI step-instrumentation split across two tasks by operation
  group) instead of a single "contract + one reference wiring" task, to keep each task's
  diff reviewable. See `areas/operation-progress-contract.md` and
  `tasks/04`-`tasks/06`.
- **Date:** 2026-08-15
- **Affected artifacts:** `areas/operation-progress-contract.md`,
  `tasks/04-operation-progress-contract-and-transport.md`,
  `tasks/05-cli-step-instrumentation-gate-and-verification.md`,
  `tasks/06-cli-step-instrumentation-tests-and-audits.md`, `overview.md`

## D3: Field lists in lightweight contracts are a floor, not a ceiling

- **Question:** raised mid-discovery by the owner, not posed by the agent: for
  endpoints like the lightweight task-statuses endpoint, should the payload fields
  listed in the original request be treated as an exact/closed shape, or as a minimum?
- **Decision:** treat every field list given for a new lightweight contract (task
  statuses, PR list metadata, file manifest, etc.) as a minimum. Include additional
  fields when they are already computed or cheaply available (no new expensive
  computation or I/O) and clearly useful to the dashboard.
- **Rationale:** owner-stated — avoid a second round-trip/spec-refine just to add an
  obviously-useful field that was already sitting in memory.
- **Consequences:** task front matter and acceptance criteria for the lightweight
  contracts (tasks 01-02) describe the minimum required fields; task implementers may
  add more from data already computed in the same code path without that being a scope
  change requiring re-approval, as long as it adds no new I/O/computation cost to the
  fast path.
- **Date:** 2026-08-15
- **Affected artifacts:** `areas/dashboard-data-loading-contracts.md`,
  `areas/pull-request-file-and-diff-loading.md`,
  `tasks/01-dashboard-data-loading-contracts.md`,
  `tasks/02-pr-file-manifest-and-diff-hydration.md`

## D4: `GET /actions` must never run a heavy check; `finalize` gets multi-step
   instrumentation

- **Question:** raised by the owner reviewing the spec, not posed by the agent — the
  spec had assumed `GET /api/specs/active/:slug/actions`'s `--check` gate probes were
  uniformly cheap and could stay synchronous forever. Is that actually true for
  `finalize`?
- **Decision:** no — `finalize --check` can run spec/docs validation, index checks,
  GitHub PR/review-state checks, and `dotnet build`/`dotnet test`. `GET /actions` must
  never trigger that on a poll; it reports only lightweight, already-cheap facts for
  `finalize`'s button state. The authoritative check moves into the `finalize`
  operation's own steps once triggered, decomposed into `finalize --check`/
  `handleFinalize`'s real phases (validate specs, check indexes, validate docs, check
  PR/review state, build, test, finalize) — never one collapsed "Checking gate..."
  step. The task-level (`verify`/`approve`) gate probe is unaffected — it genuinely is
  cheap and stays on `GET` as before.
- **Rationale:** owner-stated — a periodic `GET` running build/test is exactly the
  "cheap because the response is small" trap this change already corrected for
  `/api/dashboard`.
- **Consequences:** `actions.mjs`'s `GET` handler for `finalize` changes; task 05's
  scope expands to include `finalize`'s full step breakdown.
- **Date:** 2026-08-15
- **Affected artifacts:** `areas/operation-progress-contract.md`,
  `tasks/04-operation-progress-contract-and-transport.md`,
  `tasks/05-cli-step-instrumentation-gate-and-verification.md`

## D5: PR-list metadata refresh must not rely on `specs-changed` SSE

- **Question:** raised by the owner — a `git push` to an open PR changes GitHub's
  `headSha` without touching any file under `specs/active/`/`specs/archive/`. Can
  PR-list metadata rely on the `specs-changed` SSE watcher the way markdown content
  does?
- **Decision:** no. PR-list metadata uses initial fetch + refetch-on-window-focus +
  explicit user-triggered refresh + an optional slow safety interval (well above the
  removed 30s), independent of `specs-changed`. This still removes the old tight poll
  without silently going stale.
- **Rationale:** owner-stated — `specs-changed` structurally cannot observe a GitHub
  push; relying on it alone would mean a new `headSha` (and therefore new diffs) is
  never noticed without a manual reload.
- **Consequences:** task 01's PR-list requirement is no longer identical to its content
  requirement; task 02's `headSha`-keyed diff cache depends on this mechanism to ever
  see a new `headSha`.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md`, `areas/dashboard-data-loading-contracts.md`,
  `areas/pull-request-file-and-diff-loading.md`,
  `tasks/01-dashboard-data-loading-contracts.md`

## D6: Cancellation removed from this change's scope

- **Question:** raised by the owner — does moving `actions.mjs` to `spawn` actually make
  `POST /operations/:id/cancel` safe to implement now, as the spec previously assumed?
- **Decision:** no — remove cancellation entirely from this change. A CLI command's own
  child processes (e.g. `dotnet test` under `handleSelfCheck`) are not guaranteed to
  terminate just because the top-level `spawn`ed process is killed; killing only the
  direct child does not reliably terminate the whole process tree. The `Operation`
  model keeps `operationId` and a generic `Operation`/`Step` shape so a future change
  can add real cancellation (with correct process-tree handling) without a breaking
  contract change, but no cancel endpoint, UI control, or AC ships in this change.
- **Rationale:** owner-stated — the original "cheap because we moved to spawn"
  justification was wrong.
- **Consequences:** removed from area `operation-progress-contract.md`, tasks 04/07, and
  area `dashboard-operation-progress-ui.md`; no cancel route/control anywhere in this
  change.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md`, `areas/operation-progress-contract.md`,
  `areas/dashboard-operation-progress-ui.md`,
  `tasks/04-operation-progress-contract-and-transport.md`,
  `tasks/07-dashboard-operation-progress-ui.md`

## D7: Tasks 05 and 06 must not be implemented in parallel

- **Question:** raised by the owner — tasks 05 and 06 both modify `tools/specs.mjs`
  with no dependency between them; the workflow could mark both `ready` at once.
- **Decision:** task 06 additionally depends on task 05 (chain: 04 → 05 → 06). Task 07
  keeps its own dependencies (04, 05) unchanged.
- **Rationale:** owner-stated — avoid two tasks editing the same central file in
  parallel.
- **Consequences:** `change.yaml`'s task 06 entry gains
  `cli-step-instrumentation-gate-and-verification` in `depends_on`; task 06 cannot start
  until task 05 is approved/implemented per the normal dependency-readiness rule.
- **Date:** 2026-08-15
- **Affected artifacts:** `change.yaml`,
  `tasks/06-cli-step-instrumentation-tests-and-audits.md`

## D8: Tasks 01 and 04 must not be implemented in parallel

- **Question:** raised by the owner reviewing PR #27 — task 01
  (`dashboard-data-loading-contracts`) and task 04
  (`operation-progress-contract-and-transport`) have no dependency between them, but
  both may touch the same central files: `tools/dashboard/server/index.mjs` (route
  registration) and `tools/dashboard/src/lib/types.ts` (shared type definitions). The
  workflow could mark both `ready` at once.
- **Decision:** task 04 additionally depends on task 01 (simple sequence: 01 → 04 → 05
  → 06 → 07, with 07 keeping its existing dependency on 05 too). The two areas
  (`dashboard-data-loading-contracts.md`, `operation-progress-contract.md`) remain
  architecturally independent — this is a file-conflict-avoidance ordering, the same
  pattern as D7, not a new content dependency.
- **Rationale:** owner-stated — same reasoning as D7: don't let two tasks race to edit
  the same central server-wiring/type files. Task 01 is already first in the change
  (`order: 1`), so sequencing after it is the simple choice rather than reordering
  around it.
- **Consequences:** `change.yaml`'s task 04 entry gains
  `dashboard-data-loading-contracts` in `depends_on` (mirroring D7's own resolution for
  tasks 05/06 — a dependency edge, not an `allowed_paths` rewrite); task 04 stays
  `tools/dashboard/server/**` and task 01's own scope is unaffected, since the
  dependency alone already prevents the two from running concurrently. Each task's
  `forbidden_paths` additionally gains the other's clearly-exclusive files
  (`actions.mjs` excluded from task 01; `data.mjs`/`watcher.mjs`/`providers/**`
  excluded from task 04) to keep ownership boundaries explicit — this does not narrow
  either task's freedom to add new files under `tools/dashboard/server/**` for its own
  work.
- **Date:** 2026-08-15
- **Affected artifacts:** `change.yaml`,
  `tasks/01-dashboard-data-loading-contracts.md`,
  `tasks/04-operation-progress-contract-and-transport.md`,
  `areas/operation-progress-contract.md`

## D9: CLI progress vocabulary vs. Dashboard Operation API — scope boundary

- **Question:** raised by the owner reviewing PR #27 — does every multi-step CLI
  command that emits the shared `operation.*` step-event vocabulary (self-check,
  batch-review, audit, finalize, ...) become something the dashboard observes,
  registers, or streams progress for — including when it's started independently by an
  agent or user outside the dashboard (e.g. `node tools/specs.mjs self-check ...`)?
- **Decision:** No. Two distinct things share a name in the earlier draft and must be
  kept separate:
  1. **CLI progress vocabulary** — `tools/lib/operation-progress.mjs` and the
     `operation.started`/`operation.step.started`/`operation.step.progress`/
     `operation.step.completed`/`operation.step.failed`/`operation.completed`/
     `operation.failed` event vocabulary. Every multi-step CLI command in scope
     (`finalize`, the `verify`/`approve` gate re-check, `self-check`, `batch-review`,
     `audit`) emits this to stdout **regardless of how it was invoked** — dashboard-
     spawned or a direct CLI/agent invocation. The helper is a neutral
     `tools/lib/**` module with no dependency on the dashboard, and the events it
     emits carry no dashboard `operationId` — the CLI has no notion of one.
  2. **Dashboard Operation API** (`operationId`, snapshot, resumable SSE) —
     owned entirely by `tools/dashboard/server`, and scoped **exclusively** to
     processes the dashboard backend itself spawns via a `POST` action in
     `actions.mjs`. The backend mints `operationId` at spawn time, reads that one
     child process's stdout, and translates the parsed `operation.*` events into the
     persisted `Operation`/`Step` snapshot it serves.
  A CLI command run directly (not spawned by the dashboard) still prints the same
  structured stdout — directly useful to an agent/user reading it — but no
  `operationId`, snapshot, or SSE stream is ever created for it. The dashboard does
  not discover, register, poll for, or attach to a CLI process it did not itself
  spawn. External/agent-started CLI process discovery is explicitly out of scope; no
  IPC, global operation bus, or CLI→dashboard callback API is added by this change.
- **Rationale:** owner-stated — the original single "Operation" framing conflated a
  neutral CLI output contract with a dashboard-only tracked resource, which would have
  implied (incorrectly) that the dashboard reaches out to observe arbitrary CLI
  invocations on the machine.
- **Consequences:** `overview.md` gains an explicit responsibility-boundary section and
  an out-of-scope bullet; `areas/operation-progress-contract.md` and
  `areas/dashboard-operation-progress-ui.md` gain clarifying language distinguishing
  "emits the shared vocabulary" from "becomes a Dashboard Operation"; tasks 05/06 gain
  the same distinction for self-check/batch-review/audit specifically (see D10 for the
  task 07 UI-verification consequence).
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md`, `areas/operation-progress-contract.md`,
  `areas/dashboard-operation-progress-ui.md`,
  `tasks/04-operation-progress-contract-and-transport.md`,
  `tasks/05-cli-step-instrumentation-gate-and-verification.md`,
  `tasks/06-cli-step-instrumentation-tests-and-audits.md`

## D10: Task 07's dashboard-UI acceptance criteria must use real dashboard actions only

- **Question:** raised by the owner — `tools/dashboard/server/actions.mjs` only ever
  triggers three action kinds via `POST`: the task-level gate re-check (inside
  `verify`/`approve`), task acceptance (`approve`), and `finalize`. No dashboard route
  exists for `self-check` (the dashboard's `verify` action calls `handleVerify`, a
  simple status transition — not `handleSelfCheck`) or for batch-review. Given D9, is it
  still correct for task 07's/its area's acceptance criteria to require a real
  (not-mocked) UI run of a "self-check" or task-06 (batch-review/audit) operation kind?
- **Decision:** No. Task 07's and `dashboard-operation-progress-ui.md`'s acceptance
  criteria are corrected to require a real, not-mocked run only against an operation
  kind actually reachable as a dashboard action today (gate re-check, task acceptance,
  or — as the primary example, matching the owner's worked example of
  Validate state/Validate spec-docs/Check PR-review state/Build/Tests/Persist-finalize —
  `finalize`, since it is the one genuinely multi-step, long-running dashboard-triggered
  flow among the three). Any second operation kind used to prove the rendering
  component is kind-agnostic (e.g. self-check's or batch-review's `type`) is exercised
  via a fixture/mock `Operation` payload, not a real trigger, since the dashboard has no
  button for it. If self-check or batch-review is later wired as an actual dashboard
  action, it becomes a valid additional real-run example at that time — not before.
- **Rationale:** owner-stated — UI acceptance criteria must be verifiable against the
  actual dashboard action surface, not against operations that only exist as
  CLI-invoked commands.
- **Consequences:** `tasks/07-dashboard-operation-progress-ui.md` AC1/AC2/AC4 and
  `areas/dashboard-operation-progress-ui.md`'s area-specific AC1 are reworded to name
  `finalize` (and the gate-check/acceptance actions) as the real-run evidence and a
  fixture payload as the second kind, removing the requirement that a task-06 (CLI-only)
  kind be triggered for real from the dashboard.
- **Date:** 2026-08-15
- **Affected artifacts:** `tasks/07-dashboard-operation-progress-ui.md`,
  `areas/dashboard-operation-progress-ui.md`

## D11: Dashboard Operation lifecycle = exactly one spawned CLI process, matching the actual action flow

- **Question:** raised by the owner reviewing PR #27 — task 04 modeled "Operation = one
  spawned CLI process," but `actions.mjs`'s current `executeSpecificationAction` runs a
  separate `--check` pre-flight CLI invocation (`taskGate` for `verify`/`approve`;
  `finalizeGate` for `finalize`) and only spawns the real action command afterward, if
  the pre-flight passed — so one dashboard click currently triggers two separate CLI
  process spawns. Task 05 then described the pre-flight `--check` call itself as "a step
  *inside*" the real action's Operation, which contradicts the one-process model and
  raises the question of which of the two spawned processes' stdout is actually
  authoritative for the Operation's step events. Should a Dashboard Operation aggregate
  multiple child processes (pre-flight + real command), or should the POST handler
  collapse to exactly one spawn?
- **Decision:** Exactly one spawned CLI process per Dashboard Operation, always.
  `executeSpecificationAction`'s POST handlers for `verify`/`approve`/`finalize` no
  longer run a `--check` pre-flight before spawning the real command — they spawn the
  real command (`[action, slug, task.id]` or `['finalize', slug]`) directly. Each real
  command already performs its own authoritative validation internally, before
  mutating, and already refuses to mutate on failure: `handleVerify`/`handleApprove`
  via `validateTransition` (throws `CliError`, exits non-zero, does not write a status
  change); `handleFinalize` via its existing unconditional `gatherFinalizeFacts`/
  `validateFinalize` call (the same call `--check` mode also uses — see
  `tools/specs.mjs:1125-1136`) before any archive/push/merge. That existing internal
  validation becomes the Operation's first semantic step(s) once instrumented (task 05)
  — never a separate process, never treated as happening "before" the Operation starts.
  Concretely, the flow for any instrumented POST action is:
  `POST action → mint operationId → spawn exactly one real CLI command → that command's
  own authoritative validation/gate emits the first semantic step(s) → on failure,
  operation.failed, no mutation; on success, the same process continues into
  mutation/finalization → operation.completed`.
  `GET /api/specs/active/:slug/actions` is unaffected by this decision (D4 already
  governs it) — it remains a cheap, synchronous read correlated with no spawn and no
  `operationId`; the task-level `GET` probe may still reuse the exported
  `taskGate`/`finalizeGate`-shaped helpers for its own lightweight read, since that read
  path was never the one spawning a redundant second process.
- **Rationale:** owner-stated — a Dashboard Operation must map 1:1 onto the actual CLI
  invocation the dashboard triggers; a hidden second spawn undermines "the CLI is the
  source of truth" (two processes' stdout, only one of which the Operation actually
  reflects) and needlessly doubles process-spawn cost per click.
- **Consequences:** `actions.mjs`'s `executeSpecificationAction` drops its
  `taskGate`/`finalizeGate` pre-flight calls entirely (task 04 — it owns
  `executeSpecificationAction`'s spawn/transport behavior). Task 04's Implementation
  constraints and acceptance criteria gain the explicit one-process rule. Task 05's Goal
  items 1 and 4 and its Implementation constraints are reworded: the task-level
  validation and `finalize`'s multi-phase validation are now described as the first
  internal step(s) of the one already-spawned real command, never as a separate
  pre-flight process or a step "inside" something external to that command.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md`, `areas/operation-progress-contract.md`,
  `tasks/04-operation-progress-contract-and-transport.md`,
  `tasks/05-cli-step-instrumentation-gate-and-verification.md`
