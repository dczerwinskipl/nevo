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
  constraints: [C1, C2, C4, C6, C8]
---

# Task: AI assistant chat and runtime feature slice

## Goal

Refactor the AI Assistant Chat capability into a cohesive vertical feature slice, decomposing the assistant runtime (`lib/nevo-assistant-runtime.ts`) by responsibility, organizing AI session queries feature-locally, separating browser viewport and session creation concerns from page layout, and retiring redundant exports from `use-dashboard-data.ts`.

## Problem

- In `components/ai-chat.tsx`, `useChatVisualViewport` owns an independent browser visual viewport, orientation, focus, and keyboard lifecycle that is embedded directly in the page component (§1.1, §6.1 of `react-component-guidelines.md`).
- `CreateAiSessionDialog` represents an independent modal form interaction contract embedded within `ai-chat.tsx` (§2.3).
- `lib/nevo-assistant-runtime.ts` conflates multiple distinct responsibilities: pure message state transitions, SSE event stream decoding, snapshot loading, HTTP turn execution, React runtime state, and `@assistant-ui/react` UI adapter bridge bindings.
- AI chat helpers and projections (`chat-projection.ts`, `ai-chat-helpers.ts`, `tool-activity-labels.ts`, `use-scroll-follow.ts`, `pending-dispatch-store.ts`) are scattered globally in `src/lib/` rather than being owned feature-locally by the AI chat feature slice (§2.4).
- AI session queries (`useAiProviders`, `useAiSessions`, `useAiSession`, `useAiMessages`, `useAiTurn`) remain in the global `use-dashboard-data.ts` (§6.2).

## Expected outcome

- `useChatVisualViewport` and `CreateAiSessionDialog` are separated into feature-local modules with clear lifecycle and interaction ownership, keeping `ai-chat.tsx` focused on page orchestration.
- `nevo-assistant-runtime.ts` is restructured by responsibility: separating pure message state transformations and SSE stream handling from UI adapter bindings and HTTP turn execution.
- AI session queries are extracted into a feature-local query module, migrating AI callers and retiring remaining redundant exports from `use-dashboard-data.ts`.
- AI-specific helpers, projections, and scroll-follow hooks are consolidated feature-locally under the AI assistant feature.

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
- Modifying Node server routing code.
