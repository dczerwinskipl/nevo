---
review-of: task
change: ai-spec-history
task: activity-query-and-export
generated: 2026-10-10
verdict: pass-with-unresolved-finding
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review finding: activity-query-and-export (retroactive, filed from task 08's review)

This task's own acceptance criteria were met (`activity-query.test.mjs`,
`specs.mjs validate` passed) and its own `review` step correctly recorded `result: pass`
(commit `953b2186`). This note does not reopen that verdict — it records a defect in
this task's implementation attempt that neither its own review nor any later task's
review caught until task 08 (`activity-adr-and-docs`) happened to declare
`node tools/specs.mjs check` in its own `## Verification` section.

## Finding

The implementation commit (`95483bb7`, 2026-10-10T12:40:02+02:00) mutated
`specs/active/ai-spec-history/change.yaml` (`workflow_progress` transition) without
regenerating `specs/index.generated.json`. That file was last fresh as of `ffa07b51`
(12:27:38+02:00) — this commit is the one that broke it.

This was not caught locally because this task's own `## Verification` section lists only
`node --test tools/tests/activity-query.test.mjs` and `node tools/specs.mjs validate` —
never `specs.mjs check` — and the agent-facing CLI's `test` exit gate
(`tools/specs/workflow/cli.mjs`, `runCliCommandWithLiveOutput`) runs exactly the commands
a task declares in its own `## Verification` section, nothing more. No bypass, no
`--no-verify`, no manual edit — the local gate structurally never exercised index
freshness for this task.

It **was** caught by `.github/workflows/tool-tests.yml`'s unconditional
`npm run specs:check` step: PR #53 (`feature/ai-spec-history`) went red at the very next
CI run after this commit (run `38045700157`, 2026-10-10T10:40:08Z) and has stayed red
continuously since — through tasks 05, 06, 07, and 08's own pushes — without being
addressed.

## Disposition

Not fixed inside this task or task 08 — regenerating `specs/index.generated.json` touches
a path outside every task's `allowed_paths` in this change. Owner decision (2026-10-10,
during task 08's review): treat as a standalone repository-maintenance commit, done once
task 08's active execution is safely released; see memory
`project-ai-spec-history-review-findings` and the architectural follow-up
`project-specs-index-staleness-control-plane-boundary` for the structural fix this
motivates (the control plane should keep this index in sync itself, rather than depending
on a given task's author remembering to list `specs.mjs check`).

## Scope

- [x] Acceptance criteria: 2/2 (task's own, unaffected by this finding)
- [ ] Scope: generated-index drift outside every task's `allowed_paths` — unresolved,
      deferred to a separate maintenance commit (not a `forbidden_paths` violation; no
      file in this task's own scope is implicated)
- [ ] Findings: 1 unresolved (this one) — CI red on PR #53 since 2026-10-10T10:40Z
