# Review report template

A guide, not mandatory boilerplate. Omit any section with nothing to say.

## Verdict

Ready / not ready (spec review) or pass / fail (task review), in one line.

## Blockers

Findings that must be resolved before proceeding. Empty list is a valid, good outcome —
state it explicitly ("no blockers found") rather than omitting the section.

## Owner decisions required *(omit if none)*

Open questions that block readiness.

## Scope compliance *(task review)*

Whether the diff stayed within `allowed_paths` and away from `forbidden_paths`.

## Acceptance-criteria coverage

Which acceptance criteria are met, which are not, which are untestable as written.

## Architecture compliance

Consistency with `docs/architecture/` and applicable ADRs.

## Tests

Whether behavior changes have corresponding test coverage.

## Documentation

Whether documentation impact was identified and (for task review) actually addressed.

## Risks *(omit if none)*

Non-blocking concerns worth flagging.

## Status recommendation

The task/change status transition recommended — not applied. Owner or explicit
instruction applies it via `tools/specs.mjs complete`/`verify`/`archive`.
