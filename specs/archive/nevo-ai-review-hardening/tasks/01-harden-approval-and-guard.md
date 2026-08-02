---
id: nevo-ai-review-hardening.harden-approval-and-guard
status: implemented
change: nevo-ai-review-hardening
context:
  required: []
  optional:
    - ../../../docs/adr/ADR-0005-deterministic-approval-and-hardened-guard.md
allowed_paths:
  - tools/specs.mjs
  - tools/docs.mjs
  - tools/tests/**
  - .claude/hooks/**
  - .claude/agents/nevo-ai-spec-researcher.md
  - .claude/commands/nevo-ai/spec-approve.md
  - .claude/commands/nevo-ai/spec-review.md
  - .claude/commands/nevo-ai/task-review.md
  - .claude/skills/nevo-ai-spec-workflow/**
  - docs/ai/specification-workflow.md
  - docs/adr/**
  - docs/development/testing.md
  - CLAUDE.md
  - specs/active/nevo-ai-review-hardening/**
  - docs/index.generated.*
  - specs/*.generated.*
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - "*.csproj"
  - "*.sln"
  - Directory.Build.props
  - Directory.Packages.props
  - global.json
  - .github/workflows/**
  - specs/active/nevo-documentation-foundation/**
---

# Task: Harden approval and the researcher Bash guard (PR #13 fix)

## Goal

Turn PR #13's Copilot findings plus the owner's manual review into fixes: a
deterministic, CLI-enforced approval gate (state machine + spec fingerprint) instead
of trust in an agent's claim; an explicit whitelist-only Bash guard instead of
regex-per-command; a structured Markdown chat-output contract instead of a dense
single line; and two small, concrete documentation corrections. Full detail:
[ADR-0005](../../../docs/adr/ADR-0005-deterministic-approval-and-hardened-guard.md).

## Acceptance criteria

See the change overview's acceptance criteria — this is the change's only task, so
they're identical; not duplicated here to avoid the two drifting apart.

## Out of scope

Same as the change overview's "Out of scope" — in particular, no change to
`specs/active/nevo-documentation-foundation/` and no approval or implementation of any
of its tasks as part of this work.
