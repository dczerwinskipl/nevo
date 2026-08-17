---
id: multi-provider-agent-sessions.dashboard-session-ux-and-spec-links
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/assistant-ui-frontend.md
    - specs/active/multi-provider-agent-sessions/tasks/06-custom-renderers-and-interaction-ui.md
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
  decisions: [D1, D3]
  constraints: [C1, C4, C6, C8]
---

# Task: Dashboard session UX and spec links

## Goal

Integrate multi-provider session navigation, provider badges, specification and task linking, session creation modal, and responsive mobile-first full-screen chat mode into the NEvo Dashboard.

## Requirements

- Update `tools/dashboard/src/components/app-sidebar.tsx` and `ai-session-list.tsx` to display multi-provider badges (Claude, Antigravity, Mock) and active turn state indicators.
- In `spec-detail.tsx`, display sessions linked to the active `spec_id` with direct deep-linking into chat.
- Implement session creation modal allowing provider selection and spec association.
- Ensure seamless responsive transitions between desktop split-panel and full-screen mobile chat.

## Verification

```bash
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
