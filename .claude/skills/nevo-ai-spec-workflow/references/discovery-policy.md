# Discovery policy

## What discovery must inspect

- Current behavior of the affected area: code, tests, examples — not assumptions about
  what the code "probably" does.
- Existing documentation: `docs/development/`, relevant `docs/decisions/`
  entries (use `node tools/docs.mjs find --scope <scope>` rather than reading everything).
- Whether an active or archived change already covers this ground
  (`node tools/specs.mjs list`, and `specs/archive/` only if there's reason to believe
  prior work exists).
- Constraints implied by accepted ADRs that touch the area.

## When to use the research subagent

Delegate to `nevo-ai-spec-researcher` when discovery would otherwise require reading many
files just to establish facts (e.g. "how does the messaging pipeline currently handle
retries", "what public surface does package X expose"). Do not delegate when the answer
is already in the task's declared context, or when the question requires a judgment call
— the researcher reports facts, it does not decide.

## Evidence requirements

Every factual claim in a discovery report must be traceable to a file path (and symbol
name or line reference where useful). "The messaging pipeline retries on failure" is not
evidence; "`MessagingPipeline.cs:142` catches `TransientException` and re-enqueues" is.

## Fact versus inference

- **Fact**: directly observed in code, tests, or docs.
- **Inference**: a conclusion drawn from facts, e.g. "no test covers concurrent access,
  so behavior under concurrency is unspecified." Always label inferences as such — never
  present them as fact.

## Examples versus tests

Examples (`examples/`) show intended usage but are not a behavior contract — they can be
stale or aspirational. Tests (`tests/`) are the actual behavior contract. When the two
disagree, treat it as an inconsistency to report, not something to silently resolve by
picking one.

## Reporting stale docs

If `docs/development/*` describes behavior that the code no longer matches, report it as
an inconsistency with both citations (doc line, code line). Do not silently trust the
doc, and do not silently trust the code — the owner decides which is authoritative going
forward (this may itself require an ADR update).

## Check for an existing solution before proposing a custom one

Before a discovery report frames a need as "we should build X," check whether the .NET
BCL or an already-referenced package already provides it. NEvo's own purpose is to give
consumers building blocks (see `README.md`) — reinventing infrastructure that already
exists elsewhere is a cost to flag, not a default to reach for. Note candidate
existing solutions as evidence for the later option analysis
(`references/solution-option-analysis.md`); a new external dependency still needs owner
approval regardless of which option is eventually chosen.

## When to stop discovery

Stop once you can state, with evidence: current behavior, affected areas, constraints,
and the open questions that remain. Do not keep exploring to "be thorough" once the
material facts needed for a specification are established — bring the open questions to
the owner instead of trying to resolve everything unilaterally.
