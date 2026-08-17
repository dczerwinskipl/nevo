---
id: multi-provider-agent-sessions.dashboard-session-ux-and-spec-binding
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/assistant-ui-frontend.md
    - specs/active/multi-provider-agent-sessions/areas/session-binding-and-context.md
    - specs/active/multi-provider-agent-sessions/tasks/08-custom-renderers-and-interaction-ui.md
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
    - tools/dashboard/src/components/spec-detail.tsx
allowed_paths:
  - tools/dashboard/src/App.tsx
  - tools/dashboard/src/components/app-sidebar.tsx
  - tools/dashboard/src/components/spec-detail.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/ai-session-create-modal.tsx
  - tools/dashboard/src/hooks/use-dashboard-data.ts
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D1, D3, D6]
  constraints: [C1, C4, C6, C7, C10]
---

# Task: Dashboard session UX and spec binding

## Goal

Integrate multi-provider session navigation, provider badges, specification and task linking using the provider-neutral backend API, session creation modal, and responsive mobile-first full-screen chat mode into the NEvo Dashboard.

## Requirements

- Update `tools/dashboard/src/components/app-sidebar.tsx` and `ai-session-list.tsx` to display multi-provider badges (Claude, Antigravity, Mock) and active turn state indicators indexed by `(provider, providerSessionId)`.
- In `spec-detail.tsx`, display sessions linked to the active `specId` via `GET /api/agent-sessions?specId=...` with direct deep-linking into chat.
- Implement session creation modal allowing provider selection and spec/task association via backend `POST /api/agent-sessions`.
- Ensure seamless responsive transitions between desktop split-panel and full-screen mobile chat.

## Verification

```bash
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
