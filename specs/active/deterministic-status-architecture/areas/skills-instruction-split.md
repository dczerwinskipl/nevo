# Area: Skills instruction split

## Responsibility

Split the shared spec-workflow skill's lifecycle-mutation instructions into an explicit
legacy set and an explicit deterministic set, after `workflow.mode` resolution, while
keeping discovery/authoring/owner-decision-policy guidance shared.

## Current state

`.claude/skills/nevo-ai-spec-workflow/SKILL.md` and its `/nevo-ai:*` commands currently
describe both legacy and deterministic command surfaces without a normative, explicit
per-mode allow/forbid split — and, per item 7 of the corrective pass, some of that shared
material embeds legacy-lifecycle assumptions directly (e.g. wording that reads as if
`approve`/`start`/`complete`/`verify` are always the correct next action, without a
mode-conditional). This area must find and move that embedded material, not just add a new
deterministic-only reference alongside it — an agent reading only the shared section must
not come away with an instruction that turns out to be wrong for a deterministic spec.
`docs/development/agent-workflow-protocol.md` already documents the deterministic execution
protocol (step start/finish, `StepContext` authoritative, no direct manifest mutation) for
deterministic task-execution agents specifically.

## Requirements

- Audit `SKILL.md` and the `/nevo-ai:*` command files for legacy-lifecycle assumptions
  embedded in otherwise-shared sections (discovery, authoring, decision policy) — move each
  one found into the new legacy instruction set below; the shared layer keeps only material
  that is actually lifecycle-neutral (discovery, authoring, decisions, artifact/context
  rules, `workflow.mode` resolution itself).
- Add an explicit, normative statement of the two lifecycle instruction sets:
  - **Legacy**: allowed — `approve`/`start`/`complete`/`verify` and the existing
    `/nevo-ai:*` commands; forbidden — any deterministic workflow lifecycle command
    (`workflow task publish`, `workflow step start`, `workflow step finish`,
    `startHumanStep`, `submitHumanStepResult`).
  - **Deterministic**: allowed — `workflow task publish`, `workflow step start`,
    `workflow step finish`, `startHumanStep`, `submitHumanStepResult` (each subject to the
    executor guard); forbidden — legacy `approve`/`start`/`complete`/`verify` and any other
    legacy lifecycle mutation.
- State explicitly that a user-invoked lifecycle command run against the wrong mode's spec
  fails/reroutes at the CLI layer (`areas/lifecycle-boundary-guards.md`,
  `areas/step-executor-model.md`) rather than silently executing legacy behavior on a
  deterministic spec — the skill instructs an agent to expect and surface that failure, not
  to route around it.
- Deterministic task-execution agents continue following the existing protocol in
  `docs/development/agent-workflow-protocol.md` unchanged (start step before modifying
  files, `StepContext` authoritative, stay within allowed paths, no direct
  `workflow`/`change.yaml` lifecycle mutation, use the finish contract, stop after a
  successful finish) — and now also: never attempt to start or finish a human-owned step.
- Generic spec-level/draft-discussion sessions (no authoritative execution task id) must not
  receive execution bootstrap — this is a restatement, at the instruction layer, of
  `areas/execution-readiness-and-session-bootstrap.md`'s "generic chat stays generic" rule,
  not a new mechanism.

## Constraints

- Do not duplicate all shared spec-workflow documentation into two parallel skills — split
  only the lifecycle-specific instruction/reference layer, and move (not copy) any legacy
  assumption found embedded in a shared section.
- No change to `/nevo-ai:*` command *behavior* for legacy specs — only instructional wording
  that was incorrectly presented as universal is corrected to be explicitly legacy-scoped.

## Interfaces and boundaries

Exposes: the normative allow/forbid statement, referenced by both `SKILL.md` and
`docs/development/agent-workflow-protocol.md` rather than restated in both.

Consumed by: any agent (Claude Code or otherwise) reading the shared skill/protocol before
acting on a spec, once its `workflow.mode` is known.

## Area-specific acceptance criteria

- Any legacy-lifecycle assumption found embedded in a shared section during the audit is
  moved (not left duplicated) into the legacy instruction set — the shared section no
  longer states or implies it universally.
- The legacy and deterministic instruction sets are each stated once, explicitly, with no
  large "if legacy / if deterministic" narrative branch mixed into unrelated shared
  sections.
- The skill explicitly states that a wrong-mode lifecycle command fails/reroutes at the CLI
  layer rather than silently executing — an agent following the skill expects the failure.
- `docs/development/agent-workflow-protocol.md`'s existing deterministic execution protocol
  is referenced, not restated, from the new deterministic instruction set, and now also
  states an agent must never attempt to start/finish a human-owned step.

## Dependencies

`areas/lifecycle-boundary-guards.md`, `areas/deterministic-task-publish.md`,
`areas/step-executor-model.md` (the instruction sets name commands/guards these areas
introduce).

## Out of scope

Any change to the `nevo-ai-spec-researcher` subagent's own read-only behavior. Full rewrite
of `docs/development/agent-workflow-protocol.md` beyond the additive boundary/allow-forbid
content this area and `areas/ownership-boundary-docs.md` add.
