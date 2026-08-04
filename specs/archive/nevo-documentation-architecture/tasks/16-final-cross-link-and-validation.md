---
id: nevo-documentation-architecture.final-cross-link-and-validation
status: draft
change: nevo-documentation-architecture
context:
  required:
    - specs/active/nevo-documentation-architecture/overview.md
    - specs/active/nevo-documentation-architecture/owner-decisions.md
    - specs/active/nevo-documentation-architecture/areas/06-navigation-and-ai-routing.md
    - docs/adr
    - AGENTS.md
    - README.md
    - .cursor/rules/nevo.mdc
    - .github/copilot-instructions.md
    - .github/pull_request_template.md
    - .claude/skills/nevo-ai-spec-workflow/references/solution-option-analysis.md
    - .claude/skills/nevo-ai-spec-workflow/references/triage-policy.md
    - .claude/skills/nevo-ai-spec-workflow/references/discovery-policy.md
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/skills/nevo-ai-spec-workflow/references/artifact-policy.md
    - .claude/skills/nevo-ai-github/SKILL.md
    - .claude/agents/nevo-ai-spec-researcher.md
  optional: []
allowed_paths:
  - docs/**
  - AGENTS.md
  - README.md
  - .cursor/rules/nevo.mdc
  - .github/copilot-instructions.md
  - .github/pull_request_template.md
  - .claude/skills/nevo-ai-spec-workflow/references/solution-option-analysis.md
  - .claude/skills/nevo-ai-spec-workflow/references/triage-policy.md
  - .claude/skills/nevo-ai-spec-workflow/references/discovery-policy.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
  - .claude/skills/nevo-ai-spec-workflow/references/artifact-policy.md
  - .claude/skills/nevo-ai-github/SKILL.md
  - .claude/agents/nevo-ai-spec-researcher.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - .claude/commands/**
---

# Task: Final cross-link and validation

## Goal

Rename `docs/adr/` → `docs/decisions/` (D1/D5), update every stale
`docs/adr/`/`docs/architecture/` path reference across `docs/**` and the specific
adapter-layer files identified in discovery, and run the full verification checklist
for this change.

## Implementation constraints

- `git mv docs/adr docs/decisions` (5 ADR files, content unchanged).
- Repo-wide path-string substitution `docs/adr/` → `docs/decisions/` and
  `docs/architecture/` → `docs/development/<new-filename>` (per the mapping in
  `overview.md` § "Proposed architecture" § "Target tree") in exactly: `AGENTS.md`,
  root `README.md`, `.cursor/rules/nevo.mdc`, `.github/copilot-instructions.md`,
  `.github/pull_request_template.md`,
  `.claude/skills/nevo-ai-spec-workflow/references/solution-option-analysis.md`,
  `references/triage-policy.md`, `references/discovery-policy.md`,
  `references/review-policy.md`, `references/artifact-policy.md`,
  `.claude/skills/nevo-ai-github/SKILL.md`, `.claude/agents/nevo-ai-spec-researcher.md`.
  Per D5, these are path-string substitutions only — no other prose or policy content
  in these files changes as part of this task.
- Do not edit `tools/tests/index-generation.test.mjs` — confirmed during discovery (D5)
  that its `docs/adr`/`docs/architecture` strings are synthetic in-memory fixture
  labels, not real paths.
- Run a full internal-link sweep across `docs/**` (every relative Markdown link) and
  fix any pointing to a pre-migration path.
- Run and record the result of the 8 reader-task validations from `overview.md` §
  "Verification strategy" as an explicit pass/fail checklist with evidence (which
  document answers each one).

## Acceptance criteria

- `docs/adr/` no longer exists; `docs/decisions/` holds all 5 ADR files, content
  unchanged from before the rename.
- No file in `docs/**` or the 11 named adapter-layer files contains a
  `docs/adr/`/`docs/architecture/` path reference.
- `node tools/docs.mjs validate` and `check` pass repo-wide.
- `node tools/specs.mjs validate` passes.
- All 8 reader-task validations are recorded with a pass/fail verdict and evidence.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs check
node tools/docs.mjs generate
node tools/specs.mjs validate
```

## Out of scope

Any content change to an ADR body or to `docs/ai/how-to-navigate.md`,
`workflow-overview.md`, `task-execution-policy.md`, `specification-workflow.md` beyond
the path-string substitution. Any `.claude/commands/**` file.
