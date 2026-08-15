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
- **Decision:** (B) — wire all listed operation kinds in this change.
- **Rationale:** not stated beyond selecting the option.
- **Consequences:** the operation-progress area is split into more than one task
  (contract/transport, then CLI step-instrumentation split across two tasks by operation
  group) instead of a single "contract + one reference wiring" task, to keep each task's
  diff reviewable. See `areas/operation-progress-contract.md` and
  `tasks/04`-`tasks/06`.
- **Date:** 2026-08-15
- **Affected artifacts:** `areas/operation-progress-contract.md`,
  `tasks/04-operation-progress-contract-and-transport.md`,
  `tasks/05-cli-step-instrumentation-gate-and-verification.md`,
  `tasks/06-cli-step-instrumentation-tests-and-audits.md`

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
