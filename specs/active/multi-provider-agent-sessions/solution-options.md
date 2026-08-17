# Solution Option Analysis

## 1. Provider Integration Strategy

### Option A: Direct Provider Branching (Rejected)
Hardcode provider logic across server endpoints and React components using conditionals (`if (provider === 'claude') ... else if (provider === 'antigravity') ...`).

- **Pros:** Fast to prototype single features.
- **Cons:** High coupling, fragile codebase, impossible to add Codex or ACP cleanly, frontend leaks provider protocols and differences.

### Option B: Provider-Neutral Contracts with Dynamic Capability Model (Selected)
Introduce a clean `AgentProvider` interface where every provider implements normalized methods (`startSession`, `resumeSession`, `startTurn`, `cancelTurn`, `respondInteraction`) and reports its `AgentCapabilities` (`interactivePermissions`, `interactiveQuestions`, `toolCalls`, `reasoning`, `cancelTurn`, `usage`). The backend normalizes all events into standard `AgentEvent` objects.

- **Pros:** Complete provider neutrality, clean separation of concerns, easy to extend with Antigravity, Codex, ACP, or Mock adapters.
- **Cons:** Requires rigorous normalization layer in provider adapters.

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
