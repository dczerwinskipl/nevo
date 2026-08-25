---
id: refaktoring-tooli.ai-assistant-chat-and-runtime-feature-slice
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-frontend-features.md
    - docs/development/react-component-guidelines.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/dashboard/src/lib/chat-projection.ts
    - tools/dashboard/src/hooks/use-dashboard-data.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/components/**
  - tools/dashboard/src/hooks/**
  - tools/dashboard/src/lib/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D4]
  constraints: [C1, C2, C4, C6, C7, C8]
---

# Task: AI assistant chat and runtime feature slice

## Goal

Refactor the AI Assistant Chat capability into a cohesive vertical feature slice, decomposing the assistant runtime adapter (`lib/nevo-assistant-runtime.ts`), organizing AI session query hooks into `src/hooks/use-ai-sessions.ts`, and consolidating feature-local helpers and projections under the AI chat feature.

## Problem

- `components/ai-chat.tsx` bundles layout orchestration with live tool execution cards, reasoning view panels, and viewport/scroll tracking (§1.1, §2.3 of `react-component-guidelines.md`).
- `lib/nevo-assistant-runtime.ts` conflates Assistant UI adapter bridge bindings, local dispatch stores, SSE event stream mapping, and message state transitions (§8.1).
- AI chat helpers and projections (`chat-projection.ts`, `ai-chat-helpers.ts`, `tool-activity-labels.ts`, `use-scroll-follow.ts`, `pending-dispatch-store.ts`) are scattered globally in `src/lib/` rather than being owned vertically by the AI chat feature slice (§2.4).
- AI session queries (`useAiProviders`, `useAiSessions`, `useAiSession`, `useAiMessages`, `useAiTurn`) are bundled in the global `use-dashboard-data.ts` (§6.2).

## Expected outcome

- `nevo-assistant-runtime.ts` is decomposed into modular layers: pure message state reducer, SSE stream subscriber, and `@assistant-ui/react` runtime adapter bindings.
- AI session queries and mutations are extracted into `use-ai-sessions.ts` (with backward-compatible re-exports in `use-dashboard-data.ts`).
- AI-specific helpers, projections, and scroll-follow hooks are consolidated feature-locally under the AI assistant feature.
- `ai-chat` subcomponents (e.g. reasoning view, tool view cards, session list) are cleanly composed with clear interaction lifecycles.

## Preserved contracts & behavior

- All AI chat streaming, message history rendering, tool call status displays, interactive prompts, and session switching must behave identically.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- Changing backend AI provider wire protocols or redesigning provider adapters in `tools/ai/**` (covered by `specs/active/ai-adapters-hardening/`).
