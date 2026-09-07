---
id: deterministic-workflow-foundation.source-control-capability
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/concrete-actions-and-vertical-poc.md
    - tools/specs/workflow/contracts.mjs
    - tools/specs/workflow/registry.mjs
    - tools/lib/git.mjs
    - tools/lib/github.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/actions/commit-and-push.mjs
  - tools/specs/workflow/actions/index.mjs
  - tools/specs/workflow/index.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/definitions/loader.mjs
  - tools/lib/git.mjs
  - tools/tests/workflow-action-commit-push.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2, D3, D4, D6, D8, D12, D13, D15]
  constraints: [C2, C3, C4, C6, C9, C10, C13, C14, C16]
---

# Task: Source-control capability (renamed from "Concrete action implementation: fail-closed commit-and-push")

## Goal

Implement the minimal source-control capability boundary the deterministic workflow
needs: a configurable `sourceControl` boundary — `enabled`/`push`/`remote` (D12) — a
local-Git reconciliation primitive in `tools/lib/git.mjs` answering "is commit X already on the
configured remote branch," and the reference `commit-and-push` action — non-mutating
check with parameter schemas (`commit.title`, `commit.message`, `include`, `exclude`) and
runtime Git facts, fail-closed execution requiring explicit file selection, and a result
shape carrying commit SHA and push status (D15) that Task 06's durable finish operation
can persist and later reconcile.

This task does not implement any GitHub-specific mutating operation (e.g. opening a PR)
— reuse `tools/lib/github.mjs` only for whatever provider-identification the config
boundary needs; do not create a second GitHub abstraction, and do not build a
provider-neutral VCS framework beyond this boundary (C13, D12).

## Implementation constraints

- Add a `sourceControl` configuration boundary (exact schema location — workflow
  definition file vs. per-change manifest — is this task's own implementation decision)
  with the semantics (D12 correction — no separate `git.enabled`, it added no capability
  beyond `sourceControl.enabled`):
  ```yaml
  sourceControl:
    enabled: true
    push: true
    remote:
      enabled: true
      provider: github
  ```
  This is hierarchical: `sourceControl.enabled` gates everything; `push` is meaningful
  only when `sourceControl.enabled: true`; `remote.enabled`/`remote.provider` is
  meaningful only when `push: true`. `remote.enabled: true` with `push: false` is an
  invalid configuration and must be rejected (or normalized to `remote.enabled: false`).
  When `sourceControl.enabled` is `false`, the commit-and-push action contributes no
  `requiredInputs` to a step's aggregated finish contract (verified by Task 06/07, not
  this task, but this task's `check(context)` must reflect the disabled state correctly
  when queried directly).
- Extend `tools/lib/git.mjs` with a reconciliation primitive — e.g. "does `origin/<branch>`
  already contain commit `<sha>`" — built on existing primitives in that file
  (`hasUpstream`, `getAheadBehind`, or a new narrow function in the same style: thin
  `execFileSync` wrapper, no shell string concatenation). This is what Task 06's durable
  finish operation needs to reconcile an `unknown` push result without re-pushing or
  re-committing.
- `check(context)` must not stage, commit, push, or mutate Git state under any
  circumstances.
- Context extraction must report `changedFiles`, `stagedFiles`, `currentBranch`,
  `baseBranch`, `existingCommits`, `taskAffectedFiles`, and — when source control/push are
  enabled — `unpushedCommits` (commits on `currentBranch` not yet on its remote-tracking
  branch).
- `execute(inputs, context)` must validate `inputs['commit.title']` and `inputs.include`.
- **Fail-Closed File Selection Invariant:** If `inputs.include` is missing, empty, or not
  an array, execution must throw `PreconditionError`. The action must NEVER implicitly
  stage all dirty files without explicit caller instruction.
- Execute stages files matching `include` (respecting `exclude`), commits with
  `commit.title`/`commit.message`, and pushes to upstream when `sourceControl.push` is
  enabled.
- `ActionExecuteResult.outputs` must carry `commit: { sha, status }` and, when pushed,
  `push: { remote, branch, expectedSha, status }` (D15) — the exact shape Task 06 persists
  into the finish-operation runtime record's `commit`/`push` stage results
  (`.nevo-ai-local/workflow-operations/<change>/<task>.json` — never `change.yaml`).
- Auto-register `commit-and-push` in the default action registry.

## Acceptance criteria

1. `CommitAndPushAction` implements `ActionContract` with ID `'commit-and-push'`. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
2. `check` produces `requiredInputs` with `commit.title` (`required: true`) and `include` (`required: true`, describing explicit file selection); when `sourceControl.enabled` is `false`, `check` reports `ready: false` (or an equivalent explicit not-applicable signal) rather than a schema implying the action can run. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
3. `check` returns factual Git context — including `unpushedCommits` when push is enabled — without altering the repository or worktree. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
4. `execute` throws `PreconditionError` if `commit.title` is missing, empty, or whitespace-only. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
5. `execute` throws `PreconditionError` if `include` is omitted, refusing to guess or stage dirty files implicitly. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
6. `execute` stages matching files, commits with the specified message, and pushes when valid explicit inputs are provided against a test repository fixture, returning `outputs.commit.sha` and `outputs.push` in the D15 shape. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
7. The new `tools/lib/git.mjs` reconciliation primitive correctly reports whether a given commit SHA is present on a given remote branch, against a test repository fixture with both a pushed and an unpushed commit. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
8. Each of the four defined configuration cases behaves as specified, verified against fixtures: (a) `sourceControl.enabled: false` — no commit, no push, no `requiredInputs`; (b) `enabled: true, push: false` — commits but never pushes; (c) `enabled: true, push: true, remote.enabled: false` — commits and pushes via plain Git, no GitHub API call; (d) `enabled: true, push: true, remote: { enabled: true, provider: github }` — same as (c) plus the provider boundary is recognized. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
9. `remote.enabled: true` with `push: false` is rejected (or normalized to `remote.enabled: false`) rather than silently accepted. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`

## Verification

```text
node --test tools/tests/workflow-action-commit-push.test.mjs
```
