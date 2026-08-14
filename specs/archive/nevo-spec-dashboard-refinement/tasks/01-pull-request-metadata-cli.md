---
id: nevo-spec-dashboard-refinement.pull-request-metadata-cli
status: draft
change: nevo-spec-dashboard-refinement
context:
  required:
    - specs/active/nevo-spec-dashboard-refinement/overview.md
    - specs/active/nevo-spec-dashboard-refinement/areas/pull-request-metadata-and-cli.md
    - specs/active/nevo-spec-dashboard-refinement/owner-decisions.md
    - tools/specs.mjs
    - tools/specs/service.mjs
    - tools/specs/validation.mjs
  optional: []
allowed_paths:
  - tools/specs.mjs
  - tools/specs/service.mjs
  - tools/specs/validation.mjs
  - tools/tests/pull-request-metadata.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2]
  constraints: [C1, C2, C3, C4, C7]
---

# Task: Pull request metadata and CLI

## Goal

Add the normalized optional `pull_requests` manifest contract and an idempotent `pull-request-add` command to the existing specification lifecycle CLI.

## Implementation constraints

- Keep normalization and validation in pure exported helpers where possible.
- Use `updateYamlFile` for the single structural write path.
- Do not contact providers or infer repository/PR values from Git state.
- Preserve existing manifests and commands unchanged.

## Acceptance criteria

1. Valid GitHub, GitLab, self-hosted GitLab, and future-provider reference shapes normalize deterministically. `automated: node --test tools/tests/pull-request-metadata.test.mjs`
2. Existing manifests without the field and manifests with valid multiple references pass specification validation. `automated: node --test tools/tests/pull-request-metadata.test.mjs`
3. Field-specific invalid values are rejected and equivalent normalized duplicates are detected. `automated: node --test tools/tests/pull-request-metadata.test.mjs`
4. `pull-request-add` locates active or archived changes, appends through the shared YAML writer, and becomes a no-op for duplicates. `automated: node --test tools/tests/pull-request-metadata.test.mjs`
5. Commander help exposes the approved command and flags. `automated: node --test tools/tests/pull-request-metadata.test.mjs`

## Verification

```text
node --test tools/tests/pull-request-metadata.test.mjs
node tools/specs.mjs validate
```

## Out of scope

- Provider network calls or PR creation.
