---
id: ai-sessions-live-chat-integration.fullscreen-chat-and-session-creation
status: draft
change: ai-sessions-live-chat-integration
depends_on: [session-navigation-and-context-surfaces]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/dashboard-session-experience.md
    - specs/active/ai-sessions-live-chat-integration/areas/provider-neutral-ai-runtime.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/hooks/use-dashboard-data.ts
    - tools/dashboard/src/lib/types.ts
    - tools/dashboard/src/index.css
  optional:
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
allowed_paths:
  - tools/dashboard/src/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
semantic_references:
  decisions: [D3, D4, D5, D9]
  constraints: [C4, C5, C7, C8, C9, C10, C11, C12, C13]
  dependency_contracts: [session-navigation-and-context-surfaces]
---

# Task: Full-screen chat and session creation

## Goal

Deliver the final mobile-first chat UX against the mock adapter, including addressable navigation, session creation, live deltas, reconnect, permissions, questions, and capability-aware controls.

## Dependencies

Depends on session entry surfaces and the tested Part 1 API.

## Implementation constraints

- Use the existing SPA fallback and platform history/URL primitives; do not add a router dependency solely for this task.
- Render only a compact context bar above chat: back navigation, spec, linked tasks, provider, title/status, and session switching.
- Load provider-owned normalized messages and append live deltas without persisting them in browser storage as a new source of truth.
- Create a session for the selected spec with zero/multiple valid task IDs and one enabled provider; optional initial message starts the first turn through the same path as the composer.
- Keep the composer usable while displaying running/waiting state; prevent accidental duplicate starts/responses.
- Render normalized Allow/Deny and one/multiple question prompts, send responses over HTTP, and continue consuming the same turn SSE.
- On EventSource/network loss, show reconnect state, fetch the turn snapshot, and retain current transcript/pending interaction.
- Hide unsupported create/send/resume/interaction/cancel controls according to capabilities.

## Acceptance criteria

1. Opening a session changes addressable URL state; refresh restores the conversation and browser back returns to its originating spec/task/list context. `inspection: deep-link, refresh, and back flow`
2. Chat fills available phone/desktop space without the large spec header or workflow cards, and the composer remains reachable with an on-screen keyboard. `inspection: responsive phone and desktop layouts`
3. Creating spec-wide, single-task, and multi-task mock sessions uses one flow and immediately opens the new conversation. `inspection: all task cardinalities`
4. A normal turn renders several incremental deltas and terminal state without duplicate text. `inspection: mock normal turn`
5. Permission Allow/Deny and `AskUserQuestion` resolve by `turnId + interactionId`, disappear after `interaction.resolved`, and the same turn continues. `inspection: mock permission and question turns`
6. Closing/reopening the stream during a pending interaction re-displays it and does not start or cancel another turn. `inspection: forced SSE reconnect`
7. Loading, failure, interrupted turn, completed read-only session, and unsupported capability states are explicit and recoverable. `automated: npm --prefix tools/dashboard run build; inspection: state matrix`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

Manual verification uses the seeded mock specification on a phone-sized viewport and desktop, including disconnect/reconnect and both interaction kinds.

## Out of scope

- Attachments, uploads, model changes, analytics, rich tools, branching, or real Claude behavior.
