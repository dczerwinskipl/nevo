---
id: ai-session-issues-and-diagnostics.semantic-work-chat-v2
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/canonical-turn-work-model.md
    - specs/active/ai-session-issues-and-diagnostics/areas/persistence-and-server-projection.md
    - specs/active/ai-session-issues-and-diagnostics/areas/chat-migration-and-validation.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
    - tools/dashboard/ui/features/agent-sessions/types.ts
  optional:
    - tools/dashboard/ui/features/agent-sessions/transcript/projection.ts
    - tools/dashboard/ui/features/agent-sessions/turn-work/turn-work-summary.tsx
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/**
  - tools/dashboard/tests/agent-session-header.test.mjs
  - tools/dashboard/tests/agent-session-runtime-state.test.mjs
  - tools/dashboard/tests/agent-turn-transport.test.mjs
  - tools/dashboard/tests/composer-interaction.test.mjs
  - tools/dashboard/tests/responsive-accessibility-regression.test.mjs
  - tools/dashboard/tests/session-details.test.mjs
  - tools/dashboard/tests/transcript-message-layout.test.mjs
  - tools/dashboard/tests/transcript-projection.test.mjs
  - tools/dashboard/tests/turn-work-correlation.test.mjs
  - tools/dashboard/tests/turn-work-summary.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3, D4, D5, D6, D7, D8, D11, D12]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C15, C16, C17, C18]
  dependency_contracts: [canonical-persistence-and-server-projection]
---

# Task: Implement semantic Work chat V2 and the temporary switch

## Goal

Build the new chronological Work/FinalAnswer chat experience entirely from the semantic server
projection and add a bounded V1/V2 representation switch so V1 remains usable during validation.

## Requirements

- Add the temporary local Chat V1/V2 selector without changing Turn/session domain state.
- Keep the current renderer as V1 and implement V2 against server projection types only.
- Render collapsed Work overall state, top-level activity count, current/latest semantic activity,
  attention summary, and expandability without unnecessary counters.
- Render expanded Work chronologically across Commentary, Reasoning, ToolInvocation, and Interaction.
- Keep ToolActions nested under their invocation and raw technical details secondary/expandable.
- Render transient server-projected wait status at the current end of active Work without persisting
  or counting it as an activity.
- Emphasize only current/relevant items; render completed history quietly.
- Render pending Interaction visibly/actionably and distinguish it from normal waiting.
- Render FinalAnswer separately below Work with pending/streaming/completed/absent semantics.
- Drive composer, cancel, delete, and session controls from semantic readiness/Turn state.
- Do not import provider modules, branch on provider identity, parse commands, or classify protocol
  text/events in UI code.

## Acceptance criteria

1. Collapsed states cover in-progress/current tool, waiting provider, waiting tool, requires
   attention, completed, failed, cancelled/interrupted, and unknown using server data.
   `automated: node --test tools/dashboard/tests/turn-work-summary.test.mjs`
2. Expanded commentary/tool/commentary/tool/final order is exact, compound actions remain nested,
   and dozens of operations remain expandable. `automated: node --test tools/dashboard/tests/transcript-projection.test.mjs tools/dashboard/tests/turn-work-correlation.test.mjs`
3. Pending permission/question/confirmation is actionable in sequence and ordinary waiting has no
   attention styling/actions. `automated: node --test tools/dashboard/tests/composer-interaction.test.mjs`
4. Cancellation/failure never promotes commentary to FinalAnswer; active Turn shows honest pending/
   absent final state. `automated: node --test tools/dashboard/tests/transcript-message-layout.test.mjs`
5. V1 and V2 inspect the same session, can switch during active work, and neither switch nor render
   mutates/cancels runtime state. `automated: node --test tools/dashboard/tests/agent-session-runtime-state.test.mjs`
6. UI production code contains no provider protocol interpretation or command-to-semantic label
   parser. `inspection: tools/dashboard/ui/features/agent-sessions dependency and string-parsing review`
7. Desktop/mobile layouts, long timelines/details, focus, buttons, and expand/collapse meet the
   feature accessibility/responsiveness requirements. `automated: node --test tools/dashboard/tests/responsive-accessibility-regression.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/turn-work-summary.test.mjs tools/dashboard/tests/transcript-projection.test.mjs tools/dashboard/tests/turn-work-correlation.test.mjs tools/dashboard/tests/composer-interaction.test.mjs tools/dashboard/tests/transcript-message-layout.test.mjs tools/dashboard/tests/agent-session-runtime-state.test.mjs tools/dashboard/tests/responsive-accessibility-regression.test.mjs
npm --prefix tools/dashboard run build
```
