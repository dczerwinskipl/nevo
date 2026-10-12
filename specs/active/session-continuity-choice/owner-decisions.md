# Owner decisions — session-continuity-choice

## D1: Session continuity is an owner choice at step start, bounded by the workflow definition

- **Question:** How should the owner be able to continue an existing agent session instead of always starting a fresh one (request changes, review, batch review)?
- **Options considered:** (1) Minimal: set `session: reuse` in `standard-v1` for request-changes and review-fail, no UI question | (2) Balanced: the definition declares the default policy, the allowed policies, and which prior step's session is the reuse candidate; the start dialog asks "continue in session X / new session"; the server validates the choice | (3) Target shape: session as a free-standing work thread per task, independent of steps
- **Decision:** Option 2.
- **Rationale:** Not given beyond choosing the recommendation. The recommendation's reasoning (recorded for traceability, not as owner rationale): option 1 is not a choice, applies to every spec, and would select the *review* session on request-changes (the server picks the latest agent step with a session). Option 3 re-models sessions for a problem the existing `execution.session` machinery already mostly solves.
- **Consequences:** Definition schema gains optional fields; the `/turns` contract accepts a `sessionPolicy` only when the transition allows it; the actions DTO exposes the candidate; the UI asks.
- **Date:** 2026-10-11
- **Affected artifacts:** tasks 01–07

## D2: Extend `standard-v1` backward-compatibly; no `standard-v2`

- **Question:** Extend the shipped `standard-v1` definition, or issue `standard-v2`?
- **Options considered:** Extend `standard-v1` with optional fields | New `standard-v2`
- **Decision:** Extend `standard-v1`; the new fields are optional and have no effect when absent.
- **Consequences:** Specs already on `standard-v1` immediately get the new choice for the transitions this change annotates. Definitions that do not declare the new fields behave exactly as today.
- **Date:** 2026-10-11
- **Affected artifacts:** task 01, `.nevo-ai/workflows/standard-v1.yaml`

## D3: "Continue in original sessions" for a batch is sequential

- **Question:** Is it acceptable that continuing several tasks in their own original sessions runs one turn after another rather than in parallel?
- **Options considered:** Sequential turns | Parallel turns
- **Decision:** Sequential (the owner accepted this as part of the selected option; ADR-0009 allows one active execution per specification, so parallel is not possible without changing it).
- **Consequences:** Task 05 starts the first turn immediately and chains the rest; the batch review report is not a single shared session artifact in this mode.
- **Date:** 2026-10-11
- **Affected artifacts:** tasks 05, 06

## D4: Defaults presented by the start dialog

- **Question:** Which choice is pre-selected?
- **Options considered:** Always "new session" | Always "continue" | Per transition, from the definition
- **Decision:** Per transition, from the definition. For `standard-v1`: request changes → continue the implementation session (default); review → new session, with continuing in the implementation session available as an explicit override that shows a warning about reduced review independence. This was part of the option text the owner accepted.
- **Consequences:** `standard-v1` annotates `human-verification → implementation` with default reuse of the `implementation` step's session. Whether review-fail → implementation also defaults to reuse is an open, non-blocking question (see overview).
- **Date:** 2026-10-11
- **Affected artifacts:** tasks 01, 04, 06
