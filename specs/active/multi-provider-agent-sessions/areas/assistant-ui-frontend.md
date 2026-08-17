# Area: Frontend Chat with Assistant-UI

## Responsibilities

This area replaces handcrafted chat mechanics in the NEvo Dashboard with `@assistant-ui/react`, bridged via a custom `NevoAssistantRuntime` adapter, styled to seamlessly blend with the existing NEvo design system and support instant thread restoration upon page reload.

## 1. Architecture & Runtime Adapter

```text
NEvo History API (/history) + SSE Stream (/events)
                     ↓
        NevoAssistantRuntime (Adapter)
                     ↓
        @assistant-ui/react UI Primitives
                     ↓
     NEvo Custom Renderers (Tailwind / Radix)
```

- **`NevoAssistantRuntime`:**
  - Implements the runtime contract expected by `@assistant-ui/react`.
  - Communicates solely through the provider-neutral backend HTTP/SSE API using `(provider, providerSessionId)`.
  - **Thread Initialization & Page Reload:** Fetches `GET /api/agent-sessions/:provider/:providerSessionId` (session state, pending interaction, and normalized thread history with `lastEventSeq` from local read-model cache), populating the thread instantly on reload.
  - **Live Streaming & Deduplication:** Connects to `GET /api/agent-sessions/:provider/:providerSessionId/events` (SSE), applying only events newer than `lastEventSeq` to eliminate duplicates.
  - **Interactions:** Renders `interaction.requested` as active UI cards in the thread and submits responses to `POST /api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond`.
  - **Turns & Cancellation:** Submits user prompts via `POST /api/agent-sessions/:provider/:providerSessionId/turns` and turn cancellation via `POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel`.

## 2. Custom Renderers & NEvo Design Tokens

- **Message Thread:** Styled with NEvo slate/zinc color tokens, balanced whitespace, and readable typography.
- **Thinking / Reasoning Blocks:** Collapsible accordions with subtle pulsing animations during generation.
- **Tool Call Cards:** Clean inspection cards showing tool name, formatted inputs, and collapsible outputs with syntax highlighting.
- **Interaction Forms:**
  - *Permission Prompts:* Action card with command/diff preview, "Allow", "Deny", and "Always Allow" buttons (rendered only when `capabilities.interactivePermissions` is true).
  - *Questions / Clarifications:* Interactive form controls for multiple-choice or freeform text answers with validation.
- **Composer:** Resizable auto-growing textarea with keybindings (Enter to send, Shift+Enter for newline, Esc to cancel).

## 3. Session Navigation & Context Surfaces

- **Specification Detail View:** Session pane showing active sessions linked to the current `specId`.
- **Sidebar Integration:** Multi-provider session switcher with provider badges (Claude, Antigravity, Mock) and status indicators (`running`, `waitingForUser`, `idle`).
- **New Session Modal:** Provider selector dropdown, initial prompt input, and optional task tagging, calling backend `POST /api/agent-sessions` with `{ provider, specId, taskId? }`.
