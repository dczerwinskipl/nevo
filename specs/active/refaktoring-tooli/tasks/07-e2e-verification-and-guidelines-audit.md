---
id: refaktoring-tooli.e2e-verification-and-guidelines-audit
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - docs/development/node-tooling-guidelines.md
    - docs/development/react-component-guidelines.md
  optional:
    - specs/active/refaktoring-tooli/areas/specs-core-and-lifecycle.md
    - specs/active/refaktoring-tooli/areas/cli-architecture.md
    - specs/active/refaktoring-tooli/areas/dashboard-server-runtime.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-architecture.md
allowed_paths:
  - tools/**
  - package.json
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3, D4]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8]
---

# Task: E2E verification and guidelines audit

## Goal

Execute end-to-end verification of the refactored `tools/` suite and dashboard, verify test completeness without regressions, and conduct a formal compliance audit against the checklists in `node-tooling-guidelines.md` and `react-component-guidelines.md`.

## Implementation constraints

- Execute the complete test suites for Node tooling and Dashboard.
- Run index checks and specification validation (`specs.mjs check`, `docs.mjs check`, `specs.mjs validate`, `docs.mjs validate`).
- Verify the absence of dead code or unused imports following the refactoring.
- Complete the audit checklist from section 14 of `node-tooling-guidelines.md` and section 11 of `react-component-guidelines.md`.

## Acceptance criteria

1. Full repository test suite passes cleanly. `automated: npm test`
2. Full dashboard test suite passes cleanly. `automated: npm --prefix tools/dashboard test`
3. Dashboard production build `npm --prefix tools/dashboard run build` finishes with exit code 0. `automated: npm --prefix tools/dashboard run build`
4. Specification and documentation validation tools report no errors. `automated: node tools/specs.mjs check && node tools/docs.mjs check`
5. All checklist items from `node-tooling-guidelines.md` and `react-component-guidelines.md` are satisfied. `inspection: checklist audit`

## Verification

```text
npm test
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
node tools/docs.mjs check
```

## Out of scope

- Changes to NEvo .NET engine code (`src/`).
