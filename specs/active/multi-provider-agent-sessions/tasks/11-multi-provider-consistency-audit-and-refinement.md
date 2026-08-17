---
id: multi-provider-agent-sessions.multi-provider-consistency-audit-and-refinement
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/provider-neutral-core.md
    - specs/active/multi-provider-agent-sessions/areas/antigravity-provider.md
    - specs/active/multi-provider-agent-sessions/tasks/09-dashboard-session-ux-and-spec-binding.md
    - specs/active/multi-provider-agent-sessions/tasks/10-antigravity-adapter-and-events.md
    - tools/ai/contracts.mjs
    - tools/ai/service.mjs
allowed_paths:
  - tools/ai/**
  - tools/dashboard/server/**
  - tools/dashboard/src/**
  - tools/tests/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D1, D4]
  constraints: [C1, C4, C7, C9]
---

# Task: Multi-provider consistency audit and refinement

## Goal

Perform a comprehensive consistency audit across Claude and Antigravity provider implementations, eliminate any remaining provider bias or leaked assumptions in core contracts, server routes, and frontend components, and ensure identical UI behaviors for common capabilities.

## Requirements

- Audit `tools/ai/contracts.mjs`, `tools/ai/service.mjs`, and API routes for residual Claude-specific naming, structures, or assumptions.
- Ensure all provider adapters and server responses strictly use `text.delta`.
- Verify that the frontend gracefully handles providers without interactive permissions (such as Antigravity) without failing or attempting unsupported interaction flows.
- Refactor any discovered contract drift across backend and frontend layers.

## Verification

```bash
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```
