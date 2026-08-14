---
id: nevo-spec-dashboard-refinement.github-provider-backend
status: draft
change: nevo-spec-dashboard-refinement
context:
  required:
    - specs/active/nevo-spec-dashboard-refinement/overview.md
    - specs/active/nevo-spec-dashboard-refinement/areas/provider-backed-changes.md
    - specs/active/nevo-spec-dashboard-refinement/owner-decisions.md
    - tools/lib/github.mjs
    - tools/specs/service.mjs
    - tools/dashboard/server/index.mjs
  optional: []
allowed_paths:
  - tools/lib/github.mjs
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  dependency_contracts: [pull-request-metadata-cli]
  decisions: [D2, D3]
  constraints: [C3, C4, C5, C6, C7]
---

# Task: GitHub provider backend

## Goal

Add a provider-neutral dashboard service and a real GitHub adapter that returns normalized pull request metadata, changed files, and full diff through the backend.

## Dependencies

Depends on `pull-request-metadata-cli` for the normalized persisted reference contract.

## Implementation constraints

- Extend the existing `gh` wrapper instead of duplicating executable discovery or credential handling.
- Keep provider mapping pure and inject provider fetchers in tests.
- Fetch file lists with pagination and full diff with the GitHub diff media type.
- Isolate failures per reference and sanitize browser-facing errors.

## Acceptance criteria

1. GitHub metadata, branches, author, aggregate stats, files, and diff map into one provider-neutral model. `automated: npm --prefix tools/dashboard test`
2. The provider registry dispatches GitHub and returns explicit unsupported results for other provider IDs. `automated: npm --prefix tools/dashboard test`
3. Mixed successful and failed references are returned independently and no error exposes credentials or command internals. `automated: npm --prefix tools/dashboard test`
4. The read-only endpoint resolves only exact active/archive specifications and performs no provider calls for an empty reference list. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
node --test tools/tests/*.test.mjs
```

## Out of scope

- GitLab network adapters or provider writes.
