# Stable specification identity

## Responsibility

Own the immutable canonical identity used by workstation-local relations while preserving slug-based human workflows and legacy manifests.

## Current state

Specification directories and CLI selectors use slug. `change.id` conventionally matches that slug but is not separately enforced as immutable. Validation and generated indexes have no stable relation key, and the spec-create adapter writes artifacts manually rather than through a `tools/specs.mjs create` command.

## Requirements

- Add additive manifest field `spec_id` containing a canonical UUID string.
- Generate `spec_id` once for new changes through the shared spec-creation guidance/template path.
- Add an explicit idempotent backfill command/service for current active and archived manifests.
- Preserve an existing valid ID and reject duplicates or invalid replacements.
- Expose `specId` alongside slug in context packets, indexes, and dashboard projections.
- Resolve slug or current human-facing selector to `spec_id` before any AI relation operation.
- Keep legacy manifests readable during migration; return a precise migration-needed error when a session operation targets one without `spec_id`.
- Once the one-time backfill has run, treat a manifest missing `spec_id` as a `validate`/`check` error (naming its path), not tolerated legacy input — reader-side tolerance (loading a manifest, building a context packet) stays permanent, but the CI-enforced check does not, so a hand-authored manifest that skips spec-create's guidance is caught rather than passing indefinitely as if it predated the migration.
- Backfill this specification itself during implementation rather than inventing a pre-feature field the current validator does not yet understand.

## Constraints

- Follow C1-C3 and D2.
- Do not redefine current `id` or require a slug rename command.
- Do not derive the durable identifier from slug, path, title, or mutable content.
- Do not assign IDs as a hidden side effect of a dashboard GET.

## Interfaces and boundaries

The spec service owns generation, validation, uniqueness, lookup, backfill, and index projection. Dashboard and AI registry code consume `specId`; they do not parse manifests independently. Slug remains an API/CLI selector and URL concern.

## Area-specific acceptance criteria

1. New-spec guidance cannot produce a conforming new manifest without a valid `spec_id`.
2. Backfill assigns IDs only to missing manifests and produces byte-stable output on a second run.
3. Duplicate IDs across active/archive fail validation with both affected manifests named.
4. Moving or renaming a spec directory while retaining its manifest leaves `specId` unchanged.
5. Current slug-based commands and dashboard selection continue to work.
6. After backfill has run once, `validate`/`check` reports a manifest missing `spec_id` as an error naming its path; loading/reading that same manifest (context packets, dashboard projections) still succeeds without it.

## Dependencies

This is the first Part 1 foundation. Provider-neutral session contracts depend on it.

## Out of scope

- A general slug rename command.
- Replacing current human-facing `id`/slug semantics.
- IDs for tasks independent of their existing task IDs.
