---
id: nevo-spec-dashboard-refinement.github-changes-ui
status: draft
change: nevo-spec-dashboard-refinement
context:
  required:
    - specs/active/nevo-spec-dashboard-refinement/overview.md
    - specs/active/nevo-spec-dashboard-refinement/areas/provider-backed-changes.md
    - specs/active/nevo-spec-dashboard-refinement/owner-decisions.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/hooks/use-dashboard-data.ts
    - tools/dashboard/src/lib/types.ts
    - docs/development/local-setup.md
  optional: []
allowed_paths:
  - tools/dashboard/src/**
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - docs/development/local-setup.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  dependency_contracts: [github-provider-backend, documents-and-task-details-ui]
  decisions: [D2, D3, D4]
  constraints: [C2, C3, C5, C6, C8]
---

# Task: GitHub-like Changes UI

## Goal

Implement the selected specification's Changes experience with independent pull request summaries and rich, collapsible, syntax-highlighted file diffs.

## Dependencies

Depends on the provider-neutral backend contract and the selected-specification tab shell.

## Implementation constraints

- Use `@git-diff-view/react` and `@git-diff-view/lowlight` rather than parsing unified diff locally.
- Keep each pull request and each changed file independently collapsible.
- Lazy-load Changes data through React Query and retain the existing 30-second freshness behavior.
- Degrade explicitly for unsupported providers, unavailable providers, binary files, and absent/truncated patches.

## Acceptance criteria

1. Zero, one, and several pull requests render coherent empty/list states without synthetic combined diffs. `inspection: fixture each reference cardinality`
2. Every successful PR shows provider link, status/draft state, head/base, author when available, aggregate additions/deletions, and changed-file count. `inspection: compare GitHub API fixture to UI`
3. Changed files show per-file status and statistics, old/new line numbers, collapsible content, and syntax highlighting where supported. `automated: npm --prefix tools/dashboard run build; inspection: TypeScript, Markdown, rename, binary fixtures`
4. Provider failures remain scoped to their reference and retry through React Query/manual refresh. `inspection: mixed success/error fixture`
5. Local setup documentation explains the attach command, optional base URL, GitHub authentication, and unsupported-provider behavior. `inspection: review docs/development/local-setup.md`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
node tools/docs.mjs check
```

## Documentation impact

Update `docs/development/local-setup.md` with the new CLI and provider requirements.

## Out of scope

- PR creation, review comments/actions, GitLab API access, or a synthetic cross-PR diff.
