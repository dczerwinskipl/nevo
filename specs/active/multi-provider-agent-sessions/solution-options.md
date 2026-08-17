# Solution Option Analysis

## 1. AI Session Ownership & Identity Strategy

### Option A: Synthetic Nevo-Owned Session Lifecycle (Rejected)
Introduce a custom Nevo session state machine with `nevoSessionId`, wrapping provider sessions and attempting to normalize lifecycle states (`running`, `waitingForUser`, `idle`, `completed`) in a parallel state layer.

- **Pros:** Unified internal state object.
- **Cons:** Violates real provider lifecycles; causes impedance mismatch with short-lived CLI processes and provider-managed history; adds unnecessary complexity and sync overhead.

### Option B: Provider-Owned Session Lifecycle with Local Spec/Task Bindings (Selected)
Providers own their sessions, history, and lifecycles. NEvo canonically identifies an AI session as `AgentIdentity { provider, providerSessionId }`. NEvo provides a local, history-oriented binding service mapping `specId` and optional `taskId` to AI sessions, interacting with sessions through provider-specific backend adapters.

- **Pros:** Radically simpler domain model; perfectly matches CLI process reality; zero git pollution; true multi-provider flexibility.
- **Cons:** Requires adapters to handle all provider-specific execution and error semantics cleanly.

---

## 2. Frontend Chat Implementation Strategy

### Option A: Continue Handcrafted Custom Chat Mechanics (Rejected)
Manually write and maintain scroll managers, markdown parsers, thinking state machines, tool rendering pipelines, and composer auto-resize in `tools/dashboard/src/components/ai-chat.tsx`.

- **Pros:** No new npm dependencies.
- **Cons:** Reinventing generic chat infrastructure, higher maintenance burden, complex edge cases with token streaming, autoscroll jitter, and tool state lifecycles.

### Option B: Mature React Chat Runtime (`@assistant-ui/react`) with Nevo Adapter (Selected)
Install `@assistant-ui/react` (verified React 19 compatible) and build a lightweight `NevoAssistantRuntime` adapter that translates NEvo SSE events into assistant-ui thread and message state. Use NEvo-tailored Tailwind CSS and Radix UI components for message styling, tool calls, and interaction prompts.

- **Pros:** State-of-the-art chat UX out of the box, battle-tested streaming and scroll management, clean separation between UI mechanics and backend domain models.
- **Cons:** Adds `@assistant-ui/react` to dashboard dependencies (negligible overhead, compatible with existing React 19 stack).
