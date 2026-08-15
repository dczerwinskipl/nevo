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
