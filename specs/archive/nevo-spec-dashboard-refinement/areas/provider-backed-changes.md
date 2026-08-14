---
id: nevo-spec-dashboard-refinement.area.provider-backed-changes
type: area
change: nevo-spec-dashboard-refinement
---

# Area: Provider-backed changes

## Responsibility

Resolve persisted pull request references through backend provider adapters and display each pull request as an independent GitHub-like change set.

## Current state

The server has no provider endpoints. `tools/lib/github.mjs` wraps authenticated `gh` calls for workflow finalization and review, while the browser has no changes UI.

## Requirements

- Introduce a provider registry/service whose adapters return one normalized pull request detail contract.
- Implement GitHub by calling authenticated `gh api` on the reference host; never return tokens, raw command errors, or absolute filesystem paths.
- Fetch PR identity/status, draft state, web URL, author, head/base branch, additions/deletions/changed-file totals, the paginated changed-file list, and full unified diff.
- Map GitHub provider values into provider-neutral state and file-status values.
- Return unsupported and failed references independently so one bad PR does not hide successful ones.
- Fetch provider details only when Changes is opened and cache them through React Query with the dashboard's existing refresh behavior.
- Present each PR separately with summary metadata, changed file list, aggregate and per-file statistics, and a link to the provider.
- Parse and render the full unified diff with `@git-diff-view/react`; files are independently collapsible and display old/new line numbers and syntax highlighting when supported.
- Preserve readable unified behavior on narrow layouts and a richer split/unified desktop experience where the library supports it safely.

## Interfaces and boundaries

The provider registry consumes only normalized persisted references. The dashboard API owns external I/O and response normalization. The React client consumes a single provider-neutral contract and contains no GitHub-specific request code.

## Area-specific acceptance criteria

1. GitHub mapping is covered with fixture responses without making network calls in tests.
2. API tests confirm the browser-facing model contains no credentials and handles mixed success/error results.
3. No attached references yields a clear Changes empty state and performs no provider request.
4. Multiple pull requests are shown independently and their diffs are never merged.
5. Binary, renamed, missing-patch, and large/truncated provider responses retain usable file-level metadata and an explicit diff availability state.

## Out of scope

- Live GitLab adapters.
- Creating pull requests, inline commenting, approvals, or merging from the dashboard.
- Synthesizing a cross-PR diff.

