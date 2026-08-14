---
id: spec.nevo-spec-dashboard-refinement
type: change
title: Specification dashboard documents and GitHub changes
status: draft
change: nevo-spec-dashboard-refinement
---

# Specification dashboard documents and GitHub changes

## Context

The first dashboard iteration provides file-backed specification navigation, summary metrics, and simplified task lanes. The owner now wants the selected specification to become a practical reading and review workspace: full specification documents, task descriptions, and provider-backed pull request changes should be available without leaving the dashboard.

## Current architecture

- `tools/specs/service.mjs` loads canonical `change.yaml` manifests and task front matter through the shared YAML service.
- `tools/dashboard/server/data.mjs` projects summaries and task status but intentionally omits full Markdown bodies.
- `tools/dashboard/server/index.mjs` exposes a read-only local HTTP API and serves the React build.
- `tools/lib/github.mjs` already performs authenticated GitHub operations through `gh` from the Node backend.
- The React client has a single selected-specification overview without document tabs, task detail interaction, or provider-backed change data.

## Problem

The dashboard cannot currently answer three routine questions: what the complete specification says, what an individual task requires, and which concrete pull requests implemented the change. Pull request identity is not persisted in canonical metadata, and deriving it from the current branch would be incorrect for specifications implemented by multiple pull requests over time.

## Constraints

- **C1.** Specification YAML and Markdown remain the source of truth for documents, tasks, and pull request references; no dashboard database or copied document storage is introduced.
- **C2.** Existing specifications without `pull_requests` remain valid and project an empty Changes state.
- **C3.** A specification may reference zero, one, or many pull requests; references are never inferred from the current branch.
- **C4.** Pull request references are provider-agnostic and identify provider, instance/base URL, repository, and provider-local PR/MR number.
- **C5.** The browser never receives provider credentials and never calls GitHub or GitLab directly.
- **C6.** Only GitHub is implemented as a live provider in this change; other provider identifiers remain persistable but report an explicit unsupported state.
- **C7.** Existing workflow lifecycle behavior and archived specifications remain compatible.
- **C8.** Full diff rendering uses a maintained library rather than a custom unified-diff parser.

## Affected modules

- `tools/specs.mjs`, `tools/specs/service.mjs`, and `tools/specs/validation.mjs` for deterministic pull request attachment and schema validation.
- `tools/lib/github.mjs` and `tools/dashboard/server/**` for provider-backed normalized read APIs.
- `tools/dashboard/src/**` and dashboard package metadata for document, task, and GitHub-like changes UI.
- Focused Node tests and local setup documentation.

## Options and trade-offs

### Rich React-native GitHub experience — selected (L)

Use `react-markdown` with `remark-gfm` for source-backed documents and `@git-diff-view/react` with `@git-diff-view/lowlight` for a GitHub-like file diff. This adds more frontend weight than a basic renderer, but directly supports line numbers, split/unified presentation primitives, syntax-aware rendering, and a React-owned interaction model.

### Smaller unified-diff component (M)

Use `react-diff-view`. It provides parsed files, hunks, line numbers, and token hooks with a smaller conceptual surface, but requires more dashboard-owned work to reach the richer GitHub experience the owner explicitly prefers.

### Generated HTML with Diff2Html (M)

Generate GitHub-like diff HTML through `diff2html`. The visual baseline is strong, but imperative HTML integration and sanitization are less cohesive with the existing React component model and make later interactive refinement harder.

## Owner decisions

- D1 continues the dashboard as a new follow-up change on `feature/nevo-spec-dashboard-refinement` after archiving the completed first iteration.
- D2 defines provider-agnostic `pull_requests` metadata and the deterministic `pull-request-add` CLI command.
- D3 selects a backend provider registry with a real GitHub adapter using existing `gh` authentication.
- D4 selects the richer GitHub-like renderer and approves its frontend dependencies.

## Proposed architecture

The change has three source-of-truth and delivery paths:

1. The specification service validates and structurally appends normalized `pull_requests` entries. The CLI is idempotent and owns the only manual attachment workflow.
2. The dashboard backend exposes source-backed document content and a provider registry. The GitHub adapter fetches PR metadata, file statistics, and full unified diff through authenticated `gh api` calls, then maps provider-specific responses into one dashboard contract.
3. The React selected-specification view gains Overview, Specification, Areas, and Changes navigation. Markdown is rendered from API content, task cards open their canonical task bodies, and each referenced pull request is displayed independently with collapsible file diffs.

Provider failures are isolated per pull request so one unavailable or unsupported reference does not hide other changes or local specification content.

## Compatibility and migration

`pull_requests` is optional. No existing manifest requires modification. The dashboard treats a missing or empty list identically and shows a Changes empty state. The CLI writes the new field only after validated input and preserves unrelated YAML formatting and comments.

## Areas

- `areas/pull-request-metadata-and-cli.md` — durable reference schema, validation, and idempotent CLI attachment.
- `areas/spec-content-and-task-details.md` — source-backed Markdown documents and complete task descriptions.
- `areas/provider-backed-changes.md` — backend provider boundary, GitHub normalization, and GitHub-like Changes UI.

## Change-wide acceptance criteria

1. Existing manifests without `pull_requests` pass validation and keep current dashboard behavior.
2. A specification can persist multiple distinct pull request references and rejects structurally invalid or duplicate references.
3. The selected specification exposes full overview, area, and task Markdown without copying content to another store.
4. The frontend obtains all Git provider data only through the dashboard backend.
5. Every referenced pull request is displayed independently with status, branches, file statistics, changed files, and full diff when GitHub returns them.
6. Unsupported providers and provider failures produce explicit per-reference states without breaking the dashboard.
7. Dashboard, tooling, specs, and docs checks pass after the change.

## Verification strategy

- Node unit tests cover metadata normalization, duplicate detection, structural writes, CLI wiring, source document projection, provider dispatch, and GitHub response mapping.
- Dashboard production build validates TypeScript and frontend integration.
- Existing spec and docs checks guard generated indexes and schema compatibility.
- Desktop inspection covers Markdown rendering, task details, multiple PRs, collapsed files, diff line numbers, syntax highlighting, empty state, and provider error states.

## Out of scope

- Creating pull requests from NEvo.
- Implementing live GitLab or self-hosted GitLab API access.
- Combining multiple pull requests into one synthetic specification diff.
- Inferring changes from a branch when no pull request is attached.
- Editing documents or workflow status from the dashboard.
- Chat/session history, comments, inline review actions, or credential management UI.
