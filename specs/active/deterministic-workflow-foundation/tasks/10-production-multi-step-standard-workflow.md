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
  decisions: [D7, D18, D19, D20, D25, D26, D27]
  constraints: [C9, C21, C22, C25, C26]
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

**Exact step names, count, gate composition, and per-step behavior contract content are
this task's own implementation decision** — `areas/multi-step-workflow-orchestration.md`
§§5, 10 give non-binding, illustrative shapes only. Before implementing, record the real
decomposition as its own entry in `owner-decisions.md` (what steps, what gates each one
owns, what each step's `purpose`/`expectedWork`/`hints` say, why), following this
repository's decision-policy — do not silently pick a shape and implement it without
that record.

## Implementation constraints

- This is a pure `.nevo-ai/workflows/**`-and-docs task — **no changes to any
  `tools/specs/workflow/**` engine code**. If the new definition reveals that the schema
  or engine (Task 08/09's output) cannot actually express the desired step sequence,
  stop and report the gap rather than reaching outside `allowed_paths` to patch it —
  that would mean Task 08/09 has its own defect to fix in a follow-up, not something
  this task should route around.
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
  and prove a real multi-step definition.

## Acceptance criteria

1. `owner-decisions.md` records the real step decomposition for Standard (names, gate
   ownership per step, `purpose`/`expectedWork`/`hints` content, rationale) before the
   definition is implemented. `automated: node tools/docs.mjs validate`
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
