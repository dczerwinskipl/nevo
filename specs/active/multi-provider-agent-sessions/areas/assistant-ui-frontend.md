# Area: Frontend Chat with Assistant-UI

## Responsibilities

This area replaces handcrafted chat mechanics in the NEvo Dashboard with `@assistant-ui/react`, bridged via a custom `NevoAssistantRuntime` adapter, styled to seamlessly blend with the existing NEvo design system.

## 1. Architecture & Runtime Adapter

```text
NEvo Agent Session API / SSE Stream (AgentEvent)
                     ↓
        NevoAssistantRuntime (Adapter)
                     ↓
        @assistant-ui/react UI Primitives
                     ↓
     NEvo Custom Renderers (Tailwind / Radix)
```

- **`NevoAssistantRuntime`:**
  - Implements the runtime contract expected by `@assistant-ui/react`.
  - Connects to `GET /api/agent-sessions/:sessionId/events` (SSE).
  - Translates `text.delta` into streaming markdown blocks.
  - Translates `tool.*` events into structured tool call states (pending, running, complete, error).
  - Handles `interaction.requested` by exposing interactive widgets in the thread.
  - Submits user input via `POST /api/agent-sessions/:sessionId/turns` and cancellation via `POST /api/agent-sessions/:sessionId/turns/:turnId/cancel`.

## 2. Custom Renderers & NEvo Design Tokens

- **Message Thread:** Styled with NEvo slate/zinc color tokens, balanced whitespace, and readable typography.
- **Thinking / Reasoning Blocks:** Collapsible accordions with subtle pulsing animations during generation.
- **Tool Call Cards:** Clean inspection cards showing tool name, formatted inputs, and collapsible outputs with syntax highlighting.
- **Interaction Forms:**
  - *Permission Prompts:* Action card with command/diff preview, "Allow", "Deny", and "Always Allow" buttons.
  - *Questions / Clarifications:* Interactive form controls for multiple-choice or freeform text answers with validation.
- **Composer:** Resizable auto-growing textarea with keybindings (Enter to send, Shift+Enter for newline, Esc to cancel).

## 3. Session Navigation & Context Surfaces

- **Specification Detail View:** Collapsible or tabbed session pane showing active sessions linked to the current `spec_id`.
- **Sidebar Integration:** Multi-provider session switcher with provider badges (Claude, Antigravity, Mock) and status indicators (`running`, `waitingForUser`, `idle`).
- **New Session Modal:** Provider selector dropdown, initial prompt input, and optional task tagging.
