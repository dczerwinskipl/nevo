---
review-of: spec
change: dashboard-loading-and-progress
generated: 2026-08-15
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: c27063efe241fd2de65184724b6b82f8961d1b86f540176bd1d8a82d0b391cc9
task_fingerprints:
  dashboard-data-loading-contracts: b615f9a39c3409c6bb66237da2c095084e29ec2ffdc7b7b60b94f0fe82457671
  pr-file-manifest-and-diff-hydration: 17d8b78f5eeb35b6c1f1c6668ddf7a7b07717cf3fa00b97b358d1dbf1cb547d0
  changes-grouping-and-filtering: db51f0d8a22eabb2ff863fc4ba4d1de95faa4c7ba924b6cf93b17699c0ca9487
  operation-progress-contract-and-transport: 3605da5118e91f94d852c083ec144cb55d2ea623b062cb7aa98ff265860147d9
  cli-step-instrumentation-gate-and-verification: 37068eb52651d8cc655cd14464ebcc1d758af07726812337698ff19710d93c67
  cli-step-instrumentation-tests-and-audits: a86507dfa4ce24028260b7133331a2c1e70c76e72271b815ecad49b668547602
  dashboard-operation-progress-ui: 54c7ae76d284cf0c47dcb56454fad3910c947ec3cf48662a70f438f82c5c6b17
---

# Review: dashboard-loading-and-progress

- [x] No unresolved required fix
- [x] No unresolved owner decision
- [x] No unresolved clarification request
- [x] Verdict: ready-for-approval

The owner corrected the spec on 6 points from a PR #27 re-review (recorded as D8-D10 in
`owner-decisions.md`, on top of the existing D1-D7): (1) the CLI progress vocabulary
(`operation.*` events, emitted by every multi-step command) and the dashboard's own
`Operation` API (`operationId`/snapshot/SSE) are now explicitly separate — the latter is
scoped exclusively to processes the dashboard backend itself spawns via a `POST` action,
with external/agent-started CLI process discovery, IPC, a global operation bus, and a
CLI→dashboard callback API all explicitly out of scope (D9); (2) the shared CLI output
contract is preserved for every multi-step command regardless of trigger source
(`finalize`, `verify`'s gate re-check, `self-check`, `batch-review`, `audit`); (3) task
07's and its area's acceptance criteria no longer use `self-check`/`batch-review` as
dashboard-UI real-run evidence — neither is reachable via any existing dashboard `POST`
action (confirmed against `tools/dashboard/server/actions.mjs`, which only ever triggers
`approve`/`verify`/`finalize`) — `finalize` is now the primary real-run example, matching
the owner's own worked example (validate specs/docs, check PR/review state, build, test,
finalize) (D10); (4) `overview.md` gains an explicit CLI/dashboard-backend/frontend
responsibility-boundary section and flow diagram; (5) task 04
(`operation-progress-contract-and-transport`) now depends on task 01
(`dashboard-data-loading-contracts`) — no content dependency, but both could otherwise
touch the same central files (`tools/dashboard/server/index.mjs`,
`tools/dashboard/src/lib/types.ts`); resolved the same way D7 resolved tasks 05/06's
overlap — a dependency edge, not an `allowed_paths` rewrite — plus light
`forbidden_paths` cross-exclusions of each other's clearly-exclusive files (D8); (6) all
prior decisions (D1-D7: `picomatch` dependency, full operation-kind wiring, floor-not-
ceiling field lists, `GET /actions` never running `finalize`'s heavy check, PR-list not
relying on `specs-changed`, cancellation out of scope, tasks 05/06 not parallel) remain
untouched and unreverted.

Applied across `overview.md`, `owner-decisions.md`, `change.yaml`,
`areas/operation-progress-contract.md`, `areas/dashboard-operation-progress-ui.md`, and
`tasks/01`, `04`, `05`, `06`, `07`. During this pass, two self-inflicted
semantic-reference gaps were caught and fixed before finalizing (tasks 05/06 named `D10`
in prose without declaring it in `semantic_references.decisions` — added), and one
safety gap was caught and fixed in task 07's/its area's AC1/AC2: recommending a manual
"real run" of `finalize` for UI verification without qualification would mean actually
merging and archiving a change, unlike the lower-stakes `self-check` example it replaced
— both now require the manual run to target a disposable/sandbox change, never a real
in-flight one. Re-validated (`node tools/specs.mjs validate`, `node tools/docs.mjs
validate`), re-indexed (`node tools/specs.mjs generate`, `node tools/docs.mjs
generate`), non-gating checks clean (`node tools/specs.mjs check`, `node tools/docs.mjs
check`), and re-fingerprinted from scratch after every edit, including the two
self-corrections.
