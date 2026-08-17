---
id: multi-provider-agent-sessions.multi-provider-consistency-review-and-docs
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/provider-neutral-core.md
    - specs/active/multi-provider-agent-sessions/tasks/07-dashboard-session-ux-and-spec-links.md
    - specs/active/multi-provider-agent-sessions/tasks/09-antigravity-event-and-tool-mapping.md
    - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
    - docs/development/ai-sessions.md
allowed_paths:
  - docs/decisions/**
  - docs/development/**
  - tools/tests/**
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D1, D4]
  constraints: [C1, C4, C7]
---

# Task: Multi-provider consistency review and docs

## Goal

Perform a comprehensive consistency audit across Claude and Antigravity provider implementations, eliminate any remaining provider bias in core contracts, update architecture documentation and ADRs, and run the full end-to-end test suite.

## Requirements

- Audit `tools/ai/contracts.mjs`, `tools/ai/service.mjs`, and API routes for residual Claude-specific naming or assumptions.
- Update `docs/decisions/ADR-0007-provider-neutral-ai-sessions.md` and `docs/development/ai-sessions.md` documenting the multi-provider capability architecture and `@assistant-ui/react` runtime.
- Run complete test suite (tools unit tests, dashboard tests, specs validation, docs check).

## Verification

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
node tools/docs.mjs check
```
