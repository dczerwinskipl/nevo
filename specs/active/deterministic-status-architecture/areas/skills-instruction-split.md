# Area: Skills instruction split

## Responsibility

Split the shared spec-workflow skill's lifecycle-mutation instructions into an explicit
legacy set and an explicit deterministic set, after `workflow.mode` resolution, while
keeping discovery/authoring/owner-decision-policy guidance shared.

## Current state

`.claude/skills/nevo-ai-spec-workflow/SKILL.md` and its `/nevo-ai:*` commands currently
describe both legacy and deterministic command surfaces without a normative, explicit
per-mode allow/forbid split. `docs/development/agent-workflow-protocol.md` already
documents the deterministic execution protocol (step start/finish, `StepContext`
authoritative, no direct manifest mutation) for deterministic task-execution agents
specifically.

## Requirements

- Keep shared: discovery, task/spec authoring guidance, owner-decision policy, artifact
  sizing, context-loading rules — none of this is lifecycle-specific.
- Add an explicit, normative statement of the two lifecycle instruction sets:
  - **Legacy**: allowed — `approve`/`start`/`complete`/`verify` and the existing
    `/nevo-ai:*` commands; forbidden — any deterministic workflow lifecycle command
    (`workflow task publish`, `workflow step start`, `workflow step finish`, deterministic
    human-workflow operations).
  - **Deterministic**: allowed — `workflow task publish`, `workflow step start`,
    `workflow step finish`, deterministic human-workflow operations; forbidden — legacy
    `approve`/`start`/`complete`/`verify` and any other legacy lifecycle mutation.
- Deterministic task-execution agents continue following the existing protocol in
  `docs/development/agent-workflow-protocol.md` unchanged (start step before modifying
  files, `StepContext` authoritative, stay within allowed paths, no direct
  `workflow`/`change.yaml` lifecycle mutation, use the finish contract, stop after a
  successful finish).
- Generic spec-level/draft-discussion sessions (no authoritative execution task id) must not
  receive execution bootstrap — this is a restatement, at the instruction layer, of
  `areas/execution-readiness-and-session-bootstrap.md`'s "generic chat stays generic" rule,
  not a new mechanism.

## Constraints

- Do not duplicate all shared spec-workflow documentation into two parallel skills — split
  only the lifecycle-specific instruction/reference layer.
- No change to `/nevo-ai:*` command behavior for legacy specs.

## Interfaces and boundaries

Exposes: the normative allow/forbid statement, referenced by both `SKILL.md` and
`docs/development/agent-workflow-protocol.md` rather than restated in both.

Consumed by: any agent (Claude Code or otherwise) reading the shared skill/protocol before
acting on a spec, once its `workflow.mode` is known.

## Area-specific acceptance criteria

- The shared skill's discovery/authoring/decision-policy sections are unchanged in content
  (only the lifecycle-instruction layer is added/split).
- The legacy and deterministic instruction sets are each stated once, explicitly, with no
  large "if legacy / if deterministic" narrative branch mixed into unrelated shared
  sections.
- `docs/development/agent-workflow-protocol.md`'s existing deterministic execution protocol
  is referenced, not restated, from the new deterministic instruction set.

## Dependencies

`areas/lifecycle-boundary-guards.md`, `areas/deterministic-task-publish.md` (the
instruction sets name commands those areas introduce/guard).

## Out of scope

Any change to the `nevo-ai-spec-researcher` subagent's own read-only behavior. Full rewrite
of `docs/development/agent-workflow-protocol.md` beyond the additive boundary/allow-forbid
content this area and `areas/ownership-boundary-docs.md` add.
