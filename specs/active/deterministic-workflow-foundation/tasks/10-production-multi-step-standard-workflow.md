---
id: deterministic-workflow-foundation.production-multi-step-standard-workflow
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - .nevo-ai/workflows/standard.yaml
    - tools/specs/workflow/definitions/schema.mjs
    - docs/ai/specification-workflow.md
  optional:
    - docs/development/workflow-engine.md
allowed_paths:
  - .nevo-ai/workflows/standard.yaml
  - tools/specs/workflow/templates/standard.yaml
  - docs/development/workflow-engine.md
  - tools/tests/workflow-e2e.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D7, D18, D19, D20, D25, D26, D27, D31]
  constraints: [C9, C21, C22, C25, C26, C28]
  dependency_contracts: [multi-step-workflow-progression, fail-closed-workflow-definition-resolution]
---

# Task: Production-quality multi-step standard workflow definition

## Goal

Replace `.nevo-ai/workflows/standard.yaml`'s current single-step placeholder
(`implementation -> verified`) with a real, multi-step sequence for Nevo's primary
(Standard) specification class, proving the schema and the now-generalized engine
(Task 08) genuinely support N independently-gated steps — not just "Standard" in name
while behaving identically to before. Each step also carries a real, authored behavior
contract (D25: `purpose`/`expectedWork`/`hints`) rather than shipping the schema support
Task 08 added with no real content using it, and declares `entryStep` explicitly (D27)
rather than relying on implicit key ordering.

**Naming and sequencing Nevo's own primary specification-review workflow is a
product/process decision, not an implementation detail this task decides silently
(D31).** This task's own `allowed_paths` deliberately do **not** include
`owner-decisions.md` — recording and approving the decomposition is not something Task
10's implementation itself does; it is a **precondition** to Task 10 being approved and
started at all:

1. **Before Task 10 is approved/started:** the concrete Standard step decomposition —
   step names, count, which gates each step owns, and each step's
   `purpose`/`expectedWork`/`hints` content — is proposed (informed by Nevo's existing
   review/verification practice, the `approve`/self-check/human-verification concepts
   D16's migration map already names) and recorded as its own `owner-decisions.md`
   entry via a specification-refinement pass (`/nevo-ai:spec-refine`), then **explicitly
   approved by the owner**. `areas/multi-step-workflow-orchestration.md` §§5, 10 give
   non-binding, illustrative shapes only — they are not the proposal, and do not
   substitute for it.
2. **Task 10 itself implements only the already-approved decomposition.** If no such
   approved entry exists in `owner-decisions.md` yet, Task 10 is not ready to be
   approved/started — this is checked before implementation begins, not discovered
   partway through it. An implementer may still freely decide low-level representation
   details inside the approved shape (exact YAML formatting, which existing doc a
   `hints` entry references) — never the step sequence or gate ownership itself.

## Implementation constraints

- This is a pure `.nevo-ai/workflows/**`-and-docs task — **no changes to any
  `tools/specs/workflow/**` engine code**. If the new definition reveals that the schema
  or engine (Task 08/09's output) cannot actually express the desired step sequence,
  stop and report the gap rather than reaching outside `allowed_paths` to patch it —
  that would mean Task 08/09 has its own defect to fix in a follow-up, not something
  this task should route around.
- Do not implement against a decomposition that isn't already recorded in
  `owner-decisions.md` as approved — if the context packet's `owner-decisions.md` has no
  such entry, stop and report that the prerequisite spec-refine/approval step hasn't
  happened yet, rather than inventing a shape to unblock implementation.
- Every step must declare its own `entryGates`/`exitGates` independently — do not reuse
  one step's gate configuration as a stand-in for another's.
- The final step's transition target must be a task lifecycle status value (the
  terminal case, D19) — never accidentally another step's name. Every step declares
  exactly one `transitions` entry (D27) — the schema now rejects zero or more than one.
- Declare `entryStep` explicitly at the definition's top level (D27) — do not rely on
  implicit first-key ordering for a freshly-authored multi-step definition.
- Every step declares its own `purpose`/`expectedWork`/`hints` (D25) — real, authored
  content specific to that step's actual work, not placeholder text copy-pasted across
  steps. `hints` reference only docs/skills/files that actually exist in this
  repository.
- Preserve `commit-and-push` as the (or a) finalize action on whichever step(s)
  actually mutate tracked state — do not invent a second source-control action.
- Update `docs/development/workflow-engine.md`'s references to `standard.yaml`'s shape
  if the doc still describes the old single-step version verbatim.
- This task must not be started before Task 08 and Task 09 are both implemented — it
  depends on the generalized resolver and the fail-closed validation to safely author
  and prove a real multi-step definition — **and** before the Standard step
  decomposition is proposed, recorded, and explicitly approved per D31 above.

## Acceptance criteria

1. `owner-decisions.md` already records an owner-approved step decomposition for
   Standard (names, gate ownership per step, `purpose`/`expectedWork`/`hints` content,
   rationale) — checked as a precondition before this task's implementation begins, not
   written by this task itself (D31). `automated: node tools/docs.mjs validate`
2. `.nevo-ai/workflows/standard.yaml` declares at least three steps, each with its own
   gates and exactly one transition, an explicit `entryStep`, and the final step's
   transition targets a genuine terminal task-status value. `automated: node tools/specs.mjs validate`
3. Loading the new definition succeeds under Task 09's fail-closed validation (every
   action id and gate type referenced is registered) and Task 08's version-compatibility
   check (the definition's `version` matches what `standard`-mode changes declare).
   `automated: node --test tools/tests/workflow-e2e.test.mjs`
4. Every step declares a real, step-specific `purpose`/`expectedWork`, and any `hints`
   reference docs/skills/files that actually exist. `automated: node --test tools/tests/workflow-e2e.test.mjs`
5. `docs/development/workflow-engine.md` reflects the real multi-step shape (no stale
   single-step example left as if it were current). `automated: node tools/docs.mjs check`
6. Every existing Task 06/07/08/09 test that constructs its own inline fixture
   definition (rather than loading the real `standard.yaml`) is unaffected — this task
   changes only the shipped definition, not the engine or any fixture used by earlier
   tasks' own tests. `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node tools/specs.mjs validate
node tools/docs.mjs check
node --test tools/tests/*.test.mjs
```
