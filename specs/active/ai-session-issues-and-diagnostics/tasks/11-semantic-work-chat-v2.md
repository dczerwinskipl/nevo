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
    - specs/active/ai-session-issues-and-diagnostics/areas/work-ux-presentation.md
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
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C11, C15, C16, C17, C18]
  dependency_contracts: [canonical-persistence-and-server-projection]
---

# Task: Implement semantic Work chat V2 and the temporary switch

## Goal

Build the new chronological Work/FinalAnswer chat experience entirely from the semantic server
projection and add a bounded V1/V2 representation switch so V1 remains usable during validation.

## Requirements

- Add the temporary local Chat V1/V2 selector without changing Turn/session domain state.
- Keep the current renderer as V1 and implement V2 against server projection types only.
- Implement Level 1, the collapsed Work indicator, per `areas/work-ux-presentation.md`: overall
  state, top-level activity count, and the current/latest activity truthfully labeled as tool,
  thinking, streaming commentary, waiting-for-model, waiting-for-tool, or requires-attention, with
  spinner and continuously increasing elapsed time; no historical activity and no fake progress bar.
- Implement Level 2, the expanded Work timeline, per `areas/work-ux-presentation.md`: a lightweight,
  text-first vertical timeline with one compact line per Commentary/Reasoning/ToolInvocation/
  Interaction, ToolActions nested under their invocation, no absolute timestamps or per-row durations
  by default, and the current activity rendered separately below the historical timeline while active.
- Implement Level 3, Work Details, per `areas/work-ux-presentation.md`: a side drawer/sheet on desktop
  and a bottom/full-height sheet on mobile (a modal is acceptable if it fits the component system
  better), opened from a secondary Work action or by selecting a tool, showing the full technical
  fields already exposed by the canonical model (absolute timestamps, durations, input/output,
  command, exit code, ToolActions, provider, closure reason). The normal timeline never inlines large
  input/output/command blocks.
- Enforce the no-duplicate-active-activity invariant: an active ToolInvocation, active Reasoning, or
  streaming Commentary renders in exactly one place at a time (current activity), never
  simultaneously in the historical timeline; it moves into history only once it completes.
- Render pending Interaction visibly/actionably in its chronological position and distinguish it from
  normal waiting.
- Render FinalAnswer separately below Work with pending/streaming/completed/absent semantics; never
  render FinalAnswer a second time inside Work.
- Communicate terminal turn states (Completed/Failed/Cancelled/Interrupted) truthfully on the Work
  header without conflating tool-level failure styling, turn-terminal failure styling, and
  requires-attention styling.
- Meet the mobile requirements in `areas/work-ux-presentation.md`: one-line timeline rows with
  intelligent path truncation, no inline full command/input/output, small icons, adequate touch
  targets, no horizontal scrolling, and preserved chat scroll position when opening/closing Work
  Details.
- Drive composer, cancel, delete, and session controls from semantic readiness/Turn state.
- Do not import provider modules, branch on provider identity, parse commands, or classify protocol
  text/events in UI code.

## Acceptance criteria

1. Collapsed Work indicator covers in-progress/current tool, thinking, streaming commentary, waiting
   for model, waiting for tool, requires attention, completed, failed, cancelled/interrupted, and
   unknown using server data, with no historical activity shown at this level.
   `automated: node --test tools/dashboard/tests/turn-work-summary.test.mjs`
2. Expanded timeline commentary/tool/commentary/tool/final order is exact, compound actions remain
   nested under their invocation, dozens of operations remain compact and scannable, and no absolute
   timestamps/full technical payloads render inline.
   `automated: node --test tools/dashboard/tests/transcript-projection.test.mjs tools/dashboard/tests/turn-work-correlation.test.mjs`
3. An active ToolInvocation/Reasoning/Commentary never renders simultaneously as current activity and
   as historical timeline content; it moves into history exactly once, on completion.
   `automated: node --test tools/dashboard/tests/transcript-projection.test.mjs`
4. Pending permission/question/confirmation is actionable in sequence and ordinary waiting has no
   attention styling/actions. `automated: node --test tools/dashboard/tests/composer-interaction.test.mjs`
5. Cancellation/failure never promotes commentary to FinalAnswer; active Turn shows honest pending/
   absent final state, and FinalAnswer never renders a second time inside Work.
   `automated: node --test tools/dashboard/tests/transcript-message-layout.test.mjs`
6. V1 and V2 inspect the same session, can switch during active work, and neither switch nor render
   mutates/cancels runtime state. `automated: node --test tools/dashboard/tests/agent-session-runtime-state.test.mjs`
7. UI production code contains no provider protocol interpretation or command-to-semantic label
   parser. `inspection: tools/dashboard/ui/features/agent-sessions dependency and string-parsing review`
8. Desktop and mobile: Work Details opens without expanding the chat transcript vertically, timeline
   rows stay one line with no horizontal scrolling, and focus/buttons/expand-collapse meet the feature
   accessibility/responsiveness requirements.
   `automated: node --test tools/dashboard/tests/responsive-accessibility-regression.test.mjs`

## Verification

```text
node --experimental-strip-types --test tools/dashboard/tests/turn-work-summary.test.mjs tools/dashboard/tests/transcript-projection.test.mjs tools/dashboard/tests/turn-work-correlation.test.mjs tools/dashboard/tests/composer-interaction.test.mjs tools/dashboard/tests/transcript-message-layout.test.mjs tools/dashboard/tests/agent-session-runtime-state.test.mjs tools/dashboard/tests/responsive-accessibility-regression.test.mjs tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs
npm --prefix tools/dashboard run build
```
