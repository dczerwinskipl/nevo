# Area: Antigravity / Gemini Provider Adapter

## Responsibilities

This area implements the `AgentProvider` adapter for the local Antigravity / Gemini CLI (`agy` / `agy-node`), acting as the second mandatory provider that validates provider-neutrality and prevents Claude-specific architectural bias.

## 1. Process Execution & Machine-Readable Stream

- **Execution:** Invokes local Antigravity runtime in headless/streaming mode.
- **Session Identification:** Reads Antigravity conversation IDs and maps them to NEvo `providerSessionId`.
- **Event Translation:** Parses output stream, extracting message deltas, reasoning, tool executions, and usage telemetry.

## 2. Honest Capability Modeling

Antigravity capabilities are declared accurately without faking unsupported interactive hooks:

```ts
export const ANTIGRAVITY_CAPABILITIES: AgentCapabilities = {
  interactivePermissions: false, // In headless execution, permissions are pre-configured or policy-driven
  interactiveQuestions: true,     // Supports questions/clarification if protocol allows
  interactiveConfirmations: false,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
};
```

- When a provider declares `interactivePermissions: false`, the frontend hides or disables interactive permission prompts, relying on provider defaults rather than erroring or hacking around the missing capability.

## 3. Consistency Pass & Abstraction Verification

Following the implementation of the Antigravity adapter:
- Perform a thorough audit of `AgentProvider`, `AgentEvent`, `AgentCapabilities`, and API contracts.
- Eliminate any residual naming or structural assumptions derived from Claude Code.
- Ensure identical UI behavior for common operations (streaming, tool inspection, session switching) across both providers.
