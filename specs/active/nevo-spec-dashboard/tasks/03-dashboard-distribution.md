---
id: nevo-spec-dashboard.dashboard-distribution
status: draft
change: nevo-spec-dashboard
context:
  required:
    - specs/active/nevo-spec-dashboard/overview.md
    - specs/active/nevo-spec-dashboard/areas/distribution.md
    - specs/active/nevo-spec-dashboard/owner-decisions.md
    - package.json
    - docs/development/local-setup.md
  optional:
    - README.md
allowed_paths:
  - package.json
  - package-lock.json
  - .gitignore
  - docs/development/local-setup.md
  - README.md
  - tools/dashboard/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  dependency_contracts: [dashboard-interface]
  decisions: [D1]
  constraints: [C2, C3, C5, C6]
---

# Task: Dashboard distribution seam

## Goal

Connect the completed dashboard to repository-level commands, document local use, and verify that the production assets and Node runtime form a future CLI-packaging boundary.

## Dependencies

Depends on `dashboard-interface` so the production build and runtime contract are stable.

## Implementation constraints

- Do not publish or commit the dashboard.
- Keep generated assets out of source control while retaining reproducible build commands.
- Preserve all existing root scripts.

## Acceptance criteria

1. Repository-level commands start development mode, build assets, test the dashboard, and serve the production build. `automated: npm run dashboard:build`
2. `tools/dashboard/dist` is ignored and can be recreated from source. `inspection: inspect ignore rules and a clean rebuild`
3. Local setup documentation explains prerequisites, commands, live file-backed behavior, and the future CLI packaging seam. `inspection: review docs/development/local-setup.md`
4. Existing specs/docs checks and Node tool tests still pass. `automated: npm test && npm run specs:check && npm run docs:check`
5. Development and production starts accept host and port overrides through command arguments and environment variables, print matching links, and retain loopback defaults. `automated: npm --prefix tools/dashboard test; inspection: request /api/health through an explicitly bound address`

## Verification

```text
npm run dashboard:test
npm run dashboard:build
npm test
npm run specs:check
npm run docs:check
```

## Documentation impact

Update `docs/development/local-setup.md` and the root README only if needed for discoverability.

## Out of scope

- Publishing a package, changing CI/CD, or committing generated assets.
