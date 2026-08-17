# Area: Migration & Superseded Spec Alignment

## Superseded Specification

The previous specification (`specs/archive/ai-sessions-live-chat-integration/`) is officially superseded in architectural approach. While its goal was similar, it coupled domain models too closely to Claude Code mechanics, assumed unrealistic stdin interactive loops, and relied on custom frontend chat mechanics.

## Component Classification

### 1. Reuse Unchanged
- **Specification Identity (`spec_id`):** The immutable UUID system in `change.yaml` and manifest indexing remains untouched and fully utilized.
- **Server SSE Foundation:** Core SSE streaming headers, heartbeat, and connection management in `tools/dashboard/server/index.mjs` are reused.
- **Local Storage Isolation:** `.nevo-ai-local/` path conventions for ignored local data.

### 2. Reuse After Generalization
- **AI Contracts (`tools/ai/contracts.mjs`):** Extended with `AgentCapabilities`, `CapabilityNotSupportedError`, multi-provider registry, and standardized `AgentEvent` schemas (`text.delta`).
- **Turn Runtime (`tools/ai/turn-runtime.mjs`):** Generalized to accept any `AgentProvider` implementation, managing turn idempotency, short-lived turn processes, event fanout, and cancellation.
- **Session Binding (`tools/ai/binding-service.mjs`):** Extracted into a shared service managing `(specId, taskId, nevoSessionId, agentIdentity)` for CLI, hooks, and dashboard.

### 3. Replace
- **Handcrafted Chat UI (`tools/dashboard/src/components/ai-chat.tsx`):** Completely replaced by `@assistant-ui/react` and `NevoAssistantRuntime`. Hand-rolled autoscroll, token stitching, and prompt state machines are discarded in favor of battle-tested primitives.
- **Stdin Request-Response Model:** Replaced by officially supported `PreToolUse/defer` roundtrip across short-lived CLI processes for Claude questions and permissions.
- **Claude-Specific Types in UI (`tools/dashboard/src/lib/types.ts`):** Removed in favor of generic `AgentSession`, `AgentCapabilities`, and `AgentEvent` types.

### 4. Archive / Obsolete
- Claude-only hook configurations and bespoke prompt formatters that bypassed the generic adapter layer or assumed persistent interactive stdin loops.
