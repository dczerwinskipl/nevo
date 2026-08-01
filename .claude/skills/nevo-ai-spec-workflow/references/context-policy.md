# Context policy

## Use the CLI before reading specs

Always run `node tools/specs.mjs next` or `node tools/specs.mjs context <change> <task>`
before reading spec files directly. The CLI resolves dependencies, readiness, and
relative paths — do not replicate that logic by manually scanning `specs/active/`.

## Load only required context

From the context packet, read every file in `context.required`. Do not read anything
else in the change directory unless it is also in `context.required`.

## Optional context rules

Read `context.optional` entries only if the task's own text references them (e.g. "see
the overview for background on X"). Do not read optional context by default — it exists
to be available, not to be loaded every time.

## Archived-spec restrictions

Do not read `specs/archive/**` as part of normal context loading. The only valid reasons
are: the active task explicitly references an archived spec, the owner explicitly asks
for historical reasoning, or an ADR/active spec requires it for context. State the reason
when you do.

## When full overview is necessary

A full read of `overview.md` (beyond what `context.required` lists) is justified when:
you are the `spec-review` or `spec-refine` command evaluating the whole change, not a
single task; or a task's context is ambiguous enough that the overview is the only way
to resolve it — in which case, say so rather than silently expanding scope.

## How task context packets reduce token usage

A task's `context.required`/`context.optional`/`allowed_paths`/`forbidden_paths` exist
specifically so an implementing agent never needs the whole change loaded to act on one
task. Treat a task that requires reading the entire change to make sense as a sign the
change needs better decomposition (see `artifact-policy.md`), not as normal.

## How to avoid repeated repository-wide exploration

If discovery already established a fact (with citation), do not re-derive it in a later
phase — carry it forward from the discovery report or owner-decisions record instead of
re-scanning the codebase. Repository-wide exploration is a discovery-phase activity, not
something every command redoes from scratch.
