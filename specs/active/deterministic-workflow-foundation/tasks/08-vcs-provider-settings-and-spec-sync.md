---
id: deterministic-workflow-foundation.vcs-provider-settings-and-spec-sync
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/vcs-provider-and-sync-action.md
    - tools/specs/workflow/contracts.mjs
    - tools/lib/git.mjs
    - tools/lib/github.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs/workflow/vcs/**
  - tools/specs/workflow/actions/spec-sync-pr.mjs
  - tools/specs/workflow/actions/index.mjs
  - tools/specs/workflow/index.mjs
  - tools/tests/workflow-vcs-sync.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D9, D2, D6]
  constraints: [C2, C4, C9, C10, C11]
---

# Task: VCS provider settings and spec synchronization action

## Goal

Implement the provider-neutral version control settings resolver (`tools/specs/workflow/vcs/`) supporting GitHub, GitLab, git-local, and none, and implement the composable `spec-publish-and-sync-pr` action that deterministically automates branch creation, spec staging, committing, pushing, PR creation, and manifest attachment in a single operation.

## Implementation constraints

- Support provider resolution from workspace configuration and manifest metadata.
- Implement adapters for `github` (via `tools/lib/github.mjs`), `gitlab`, `git-local`, and `none`.
- The `spec-publish-and-sync-pr` action must expose non-mutating `check` that returns parameter schemas (`commitMessage`, `prTitle`, `prBody`) and factual Git/PR context.
- The `execute` method must execute the 6-step synchronization sequence deterministically: create/switch branch, commit, push, create PR (if provider supports it and none attached), attach PR to manifest, and commit/push attachment.
- If `vcs.provider` is `git-local` or `none`, the action must execute local operations without failing on PR creation.

## Acceptance criteria

1. `VcsProviderRegistry` resolves configured VCS providers (`github`, `gitlab`, `git-local`, `none`) with appropriate fallback defaults. `automated: node --test tools/tests/workflow-vcs-sync.test.mjs`
2. `SpecSyncPrAction` implements `ActionContract` with ID `'spec-publish-and-sync-pr'`. `automated: node --test tools/tests/workflow-vcs-sync.test.mjs`
3. `check` returns factual context (current branch, target branch, uncommitted spec files, existing PRs) without mutating repository or remote state. `automated: node --test tools/tests/workflow-vcs-sync.test.mjs`
4. `execute` completes the end-to-end synchronization sequence against a fixture repository, creating the branch, committing files, simulating PR creation, and attaching PR metadata to `change.yaml`. `automated: node --test tools/tests/workflow-vcs-sync.test.mjs`
5. When provider is `git-local`, `execute` creates the branch and commits locally without attempting remote push or PR creation. `automated: node --test tools/tests/workflow-vcs-sync.test.mjs`

## Verification

```text
node --test tools/tests/workflow-vcs-sync.test.mjs
```
