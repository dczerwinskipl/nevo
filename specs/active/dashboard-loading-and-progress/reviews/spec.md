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
spec_fingerprint: 391771fa9027a91b37d3acedd386fe8192be878a75c83fb9bbf43f296c5a2e32
task_fingerprints:
  dashboard-data-loading-contracts: a292b602a39b7bb1ddaa2d79bb097e1b33b896943cd5d756e3411bb0e80206ef
  pr-file-manifest-and-diff-hydration: 27c83070c9ee3aa7a4de7bff6cc71116cca74aea558e320b0d3bb11202aac718
  changes-grouping-and-filtering: 106be5aa795d5755b50fa6c2f4a664ee1c6d40609574d58ad483f490695c77d9
  operation-progress-contract-and-transport: acd100903256886a371414b9eeaa05d6c869eb6b96732fdf05d8a9ce88468bd9
  cli-step-instrumentation-gate-and-verification: 85de359e0dfa6d7a0e0c623508e6560c74d353f062f9267e0405c49895ad3187
  cli-step-instrumentation-tests-and-audits: c2e7ae5ff1dd85d83e42c12e381b5a6a8ce77aab1fc0a2a26785657434a99624
  dashboard-operation-progress-ui: fd8426c78cc83930d510c0d8420ce44e441d65bcf042a52e3c491a144fc41c6c
---

# Review: dashboard-loading-and-progress

- [x] No unresolved required fix
- [x] No unresolved owner decision
- [x] No unresolved clarification request
- [x] Verdict: ready-for-approval

The owner directly corrected the spec on 4 points (recorded as D4-D7 in
`owner-decisions.md`): (1) `GET /actions` must never run `finalize`'s heavy check
(spec/docs validation, index checks, PR/review-state checks, build, test) — that check
now runs only as the `finalize` operation's own multi-step breakdown, never collapsed
into one "Checking gate..." step; (2) PR-list metadata cannot rely on `specs-changed`
SSE (a GitHub push doesn't touch any watched file) — it now uses focus-refetch +
explicit refresh + an optional slow safety interval instead; (3) cancellation is
removed from this change entirely (the "spawn makes it safe" premise was wrong — a
CLI command's own child processes aren't guaranteed to die with the top-level process);
(4) task 06 now depends on task 05 (chain 04→05→06) since both modify
`tools/specs.mjs`. All four are applied across `overview.md`, the affected area docs,
and tasks 01/04/05/06/07 and `change.yaml`, with matching acceptance criteria added/
removed and `semantic_references` updated. Re-validated and re-fingerprinted from
scratch after applying them.
