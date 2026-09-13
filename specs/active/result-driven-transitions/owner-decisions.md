## D1: Closed transition value enum in v1 with extensible architecture

- **Question:** What set of transition values should be supported in the initial release of result-driven transitions, and how should future custom values be accommodated?
- **Options considered:**
  1. *Arbitrary strings immediately:* Allow workflow authors to define any string immediately.
  2. *Hardcoded permanent enum:* Hardcode `pass | fail | blocked` throughout the engine, CLI, persistence, and transition resolver.
  3. *Closed enum in v1 with extensible engine architecture:* Enforce a closed set (`pass | fail | blocked`) at definition validation time in v1, while designing persistence, history, CLI, and transition resolution around arbitrary string values (`transition.value === result`).
- **Decision:** Option 3. Restrict v1 transition values to `pass | fail | blocked` in definition validation, but do not bind the engine, persistence, or CLI contracts to a permanent enum.
- **Rationale:** A closed set prevents author typos and fragmentation in early workflows while standardizing agent interactions. Decoupling the runtime and persistence layers ensures that future changes can relax definition validation to custom values (e.g. `approved`, `changes-requested`) without requiring schema migrations or breaking existing execution state.
- **Consequences:** `tools/specs/workflow/definitions/schema.mjs` validates transition values against `KNOWN_TRANSITION_VALUES = new Set(['pass', 'fail', 'blocked'])`. Runtime resolution and persistence treat values as opaque strings.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/01-workflow-definitions-and-transitions.md`, task 01

## D2: Dual-mode transition schema (unconditional vs result-driven)

- **Question:** How should workflow definitions represent steps with a single deterministic path versus branching steps with multiple outcomes?
- **Options considered:**
  1. *Universal conditional transitions:* Require every step to declare transition values and require agents to supply synthetic results (e.g. `default` or `next`) even for linear steps.
  2. *Dual-mode transitions with mutually exclusive validation:* Allow steps to declare either exactly one unconditional transition (`{ to: string }`), or two or more result-driven transitions (`{ value: string, to: string }`).
  3. *Transition expressions:* Evaluate dynamic expressions over arbitrary execution state.
- **Decision:** Option 2. Dual-mode transitions. Unconditional steps declare `{ to: string }`; result-driven steps declare two or more `{ value: string, to: string }`.
- **Rationale:** Linear steps (like `implementation -> review`) must not burden the agent with meaningless synthetic outputs. Result-driven steps make branching explicit and declarative without introducing an unpredictable expression engine.
- **Consequences:** Workflow schema validates that a step has either 1 unconditional transition or $\ge 2$ conditional transitions with unique values from the allowed set. Mixing conditional and unconditional transitions on a single step fails closed.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/01-workflow-definitions-and-transitions.md`, task 01

## D3: Transition resolution ownership and AI scope boundary

- **Question:** How much of the workflow transition topology should be exposed to the AI agent during step execution?
- **Options considered:**
  1. *Full topology exposure:* Return the complete transition graph (`result -> target step`) in the agent-facing `StepContext`.
  2. *Contract-only exposure:* Expose only the allowed result values in `finishContract.parameters.result`, keeping transition targets internal to Nevo.
  3. *Agent-driven routing:* Allow the agent to suggest or select the next step directly.
- **Decision:** Option 2. Expose only the allowed result values in the canonical finish contract. Nevo owns transition resolution exclusively.
- **Rationale:** The AI agent is a bounded executor of discrete steps, not a workflow orchestrator. The agent reports its semantic outcome (e.g. `pass` or `fail`), and Nevo deterministically computes the next step. Exposing destination step names introduces unnecessary cognitive noise and risks prompt injection or agents attempting to orchestrate their own transitions.
- **Consequences:** `StepContext` contains allowed result values in `finishContract.parameters.result.allowedValues` but omits destination step mappings.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/04-step-context-and-ai-protocol.md`, task 04
