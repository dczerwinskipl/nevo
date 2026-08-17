# Area: Antigravity / Gemini Provider Adapter

## Responsibilities

This area implements the `AgentProvider` adapter for the local Antigravity / Gemini CLI (`agy` / `agy-node`), acting as the second mandatory provider that validates provider-neutrality and prevents Claude-specific architectural bias.

## 1. Modern Session Workflow & Resumption

- Antigravity CLI provides modern multi-session workflows and conversation resumption.
- The adapter manages:
  1. Spawning Antigravity process per turn with machine-readable output.
  2. Capturing `providerSessionId` (internal conversation ID).
  3. Resuming existing conversations in new processes across turns using `(provider, providerSessionId)`.
  4. Parsing output stream into normalized `text.delta`, `reasoning.delta`, and `tool.*` events.

## 2. Honest Capability Modeling & Error Semantics

Antigravity capabilities are declared accurately based on verified CLI behaviors:

```ts
export const ANTIGRAVITY_CAPABILITIES: AgentCapabilities = {
  interactivePermissions: false, // In headless execution, permissions are policy-driven
  interactiveQuestions: true,     // Supports questions/clarification if protocol allows
  interactiveConfirmations: false,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
};
```

- When an unsupported operation (e.g. `respondInteraction` for permissions) is invoked, `AntigravityAgentProvider` throws a standard `CapabilityNotSupportedError('antigravity', 'interactivePermissions')`.
- The dashboard UI uses the provider's `capabilities` to conditionally render or disable unsupported interactive elements.

## 3. Verification & Multi-Provider Consistency Pass

- Adapter tests confirm real Antigravity CLI contract (session capture, resume, machine-readable deltas, and error codes).
- Following implementation, a multi-provider consistency pass verifies that shared contracts, event streams, and UI behaviors function identically across Claude and Antigravity.
