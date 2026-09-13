## D1: Result-driven conditional transitions vs unconditional transitions

- **Question:** How should the declarative workflow definition schema represent both simple unconditional steps and branching result-driven steps without ambiguous definitions or synthetic dummy results?
- **Options considered:**
  1. *Universal conditional transitions:* Every step declares transition values, requiring unconditional steps to provide synthetic results (e.g. `value: default` or `value: next`).
  2. *Dual-mode transitions with mutually exclusive validation:* A step declares either exactly one unconditional transition (`{ to: string }`), or two or more result-driven transitions (`{ value: string, to: string }`). Mixing unconditional and conditional transitions within a step is forbidden.
  3. *Transition expressions / mini-language:* Support boolean predicate expressions (e.g. `when: "result == 'pass' && exit_code == 0"`).
- **Decision:** Option 2. Steps declare either exactly one unconditional transition (`{ to }`) or two or more result-driven transitions (`{ value, to }`).
- **Rationale:** Unconditional steps (such as `implementation -> review`) do not require synthetic boilerplate. Conditional steps (such as `review -> pass | fail`) explicitly declare allowed machine-readable values without embedding an arbitrary expression engine. Validation fails closed if a step mixes conditional and unconditional transitions or defines duplicate values.
- **Consequences:** `tools/specs/workflow/definitions/schema.mjs` validates that each step has either 1 unconditional transition or >=2 unique value-driven transitions with safe identifier names.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/01-workflow-definitions-and-transitions.md`, task 01

## D2: Monotonic per-step attempt identity

- **Question:** How should attempt identity be derived and represented across workflow loops and repeated step visits?
- **Options considered:**
  1. *Global execution sequence counter:* A single incrementing execution counter across all steps (`execution: 1, 2, 3...`).
  2. *Monotonic per-step attempt number:* A positive 1-based integer scoped to the step (`implementation attempt 1 -> review attempt 1 -> implementation attempt 2`). Derived deterministically from history count: `history.filter(h => h.step === targetStep).length + 1`.
  3. *Random UUID attempt tokens:* Each activation generates an opaque UUID string.
- **Decision:** Option 2. Monotonic per-step attempt number (`current_attempt: 1, 2, ...`).
- **Rationale:** Per-step attempt numbering directly matches the operator and AI mental model ("attempt 2 of review"), makes loop depth immediately visible, and is derived purely from historical records without requiring a separate mutable counter.
- **Consequences:** `workflow_progress` persists `current_attempt`. `StepContext` returns `attempt`. History entries record `attempt`.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/02-attempt-identity-and-history.md`, tasks 02, 04

## D3: Attempt-scoped runtime storage for operations and human verification

- **Question:** How should durable finish operations and human verification signoffs avoid state collisions when a workflow re-enters a previously executed step?
- **Options considered:**
  1. *Flat file naming:* Suffix files with `-attempt-<N>.json` in the existing task directory (e.g. `<step>-attempt-<attempt>.json`).
  2. *Hierarchical directory scoping:* Store attempt records under step/attempt subdirectories: `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json` and `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json`.
  3. *Single file overwrite with array of attempts:* Store all attempts in a single JSON file per step.
- **Decision:** Option 2. Hierarchical directory scoping by `<step>/attempt-<attempt>`.
- **Rationale:** Directory scoping isolates each attempt into an immutable, independently addressable record. It completely eliminates collisions where an attempt 1 `completed` record falsely short-circuits attempt 2. In human verification, it guarantees that an operator signoff on attempt 1 can never silently satisfy attempt 2.
- **Consequences:** `operation-record.mjs` and `human-verification-store.mjs` update their file path builders to include `attempt`. `findInFlightOperationRecord` scans nested step/attempt directories.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/03-attempt-scoped-runtime-storage.md`, task 03

## D4: Public CLI completion parameter (`--result`) and transition resolution

- **Question:** What is the public CLI contract for supplying completion results, and what does `workflow step finish` return?
- **Options considered:**
  1. *`--outcome <value>` with generic status return:* Pass `--outcome` and return standard completion output.
  2. *`--result <value>` with explicit resolved transition object:* Add `--result <value>` to `workflow step finish` and return machine-readable transition descriptor `{ transition: { from: { step, attempt }, result, to: { step } } }`.
  3. *Positional argument:* `workflow step finish <change> [task] <result>`.
- **Decision:** Option 2. `--result <value>` flag with explicit resolved `transition` object in response.
- **Rationale:** `--result` directly maps to the `completion.parameters.result` contract exposed in `StepContext`. It distinguishes semantic output from technical status (`state: completed`). Returning the machine-readable transition provides deterministic evidence for future orchestration layers.
- **Consequences:** `cli.mjs` and `specs.mjs` add `--result`. `planFinish` validates `--result` against allowed step transitions.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/05-finish-execution-and-cli.md`, task 05

## D5: Embedded AI completion schema and authoritative protocol in StepContext

- **Question:** How should AI agents know the required completion schema and workflow execution rules without relying on custom skill prompts or natural-language prose?
- **Options considered:**
  1. *Prose instructions only:* Rely on `.claude/` or `.cursor/` skill markdown files.
  2. *Machine-readable `completion` contract in StepContext:* Return structured `completion.parameters` (with type, required, and `allowedValues` derived from the step's actual transitions) alongside an authoritative `completion.protocol` block defining participation rules.
- **Decision:** Option 2. Embed structured `completion` schema and protocol in `StepContext`.
- **Rationale:** Provider-neutral and self-contained. The AI agent inspects `StepContext` programmatically upon `step start` to discover allowed outputs, required inputs, and protocol boundaries (e.g. no direct file mutation, single finish invocation, must stop at human gates).
- **Consequences:** `step-context.mjs` compiles `completion` and `availableTransitions`, replacing static `nextStepGuidance`.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/04-step-context-and-ai-protocol.md`, task 04
