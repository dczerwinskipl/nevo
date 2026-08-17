---
id: ai-sessions-live-chat-integration.session-navigation-and-context-surfaces
status: draft
change: ai-sessions-live-chat-integration
depends_on: [ai-session-http-and-sse-api]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/dashboard-session-experience.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/hooks/use-dashboard-data.ts
    - tools/dashboard/src/lib/types.ts
  optional:
    - tools/dashboard/src/index.css
allowed_paths:
  - tools/dashboard/src/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
semantic_references:
  decisions: [D1, D9]
  constraints: [C4, C5, C6, C8, C13]
  dependency_contracts: [ai-session-http-and-sse-api]
---

# Task: Session navigation and contextual surfaces

## Goal

Add provider-neutral session queries and the three contextual entry surfaces: high-priority spec overview, active-spec global switcher, and multi-session task details.

## Dependencies

Depends on task 05's tested API payloads.

## Implementation constraints

- Keep all provider/session types and queries in shared frontend types/hooks, not embedded in individual components.
- Place recent sessions above lower-priority finalization/terminal workflow controls.
- Use status to derive current/completed presentation; do not introduce `active` state or resort differently from `lastActivityAt DESC` within groups.
- Global navigation includes sessions only from active specifications and remains compact on mobile.
- A multi-task session appears in every linked task; an empty `taskIds` session appears only in spec context.
- Make cards/rows real keyboard- and touch-operable navigation controls.
- Show explicit loading, unavailable-provider, empty, and error states without hiding core specification content.

## Acceptance criteria

1. Active spec overview shows recent current/completed sessions before finalization controls and preserves activity ordering. `automated: npm --prefix tools/dashboard run build; inspection: active specification overview`
2. Global navigation switches directly to recent sessions from active specifications and excludes archived specifications. `inspection: desktop and phone navigation`
3. Task details show zero, one, or many linked sessions and a multi-task session appears under every referenced task. `inspection: seeded demonstration tasks`
4. Session labels expose title fallback, provider, status, task context, and last activity without provider-specific fields. `automated: npm --prefix tools/dashboard run build`
5. Existing active/archive, documents, Changes, task dialog, and workflow controls remain usable. `inspection: dashboard regression pass`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

Manual inspection at representative phone and desktop widths covers every entry surface, loading/empty/error state, keyboard focus, and ordering.

## Out of scope

- Chat body, composer, creation form, or real provider setup.
