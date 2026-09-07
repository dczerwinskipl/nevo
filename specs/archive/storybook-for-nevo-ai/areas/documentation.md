# Area: documentation

## Responsibility

Document how to start/build Storybook, the story hierarchy and naming conventions, how to
add and reuse fixtures, when to use each verification tool, and how an agent selects and
verifies the relevant story before declaring a UI task complete.

## Current state

No Storybook documentation exists (nothing to document yet — this area runs after areas 2-5
produce real patterns to describe). `docs/development/` is the existing home for frontend
development documentation (`react-component-guidelines.md`, `ui-ux-guidelines.md`, etc.,
each with required front matter per `tools/docs.mjs`).

## Requirements

- A new `docs/development/storybook.md` (or an addition to an existing closely-related doc,
  decided during implementation) with required front matter (`type: development`, `status`,
  `read_when`, `summary`, `related` — matching the shape of existing docs in that
  directory), covering:
  - How to start (`npm run storybook`) and build (`npm run build-storybook`) Storybook.
  - The story hierarchy (`Foundations/*`, `Components/*`, `Patterns|Features/*`,
    `Screens/*` or whatever areas 2-5 actually converged on) and naming conventions.
  - How to add a foundation, component, feature, and screen story.
  - How to create and reuse deterministic fixtures (pointing at the scenario builder module
    from `areas/chat-stories.md`).
  - When to use direct Args vs. when a provider/decorator is justified vs. when network
    mocking is justified for a genuinely data-fetching integration story (per the original
    goal brief's guidance — direct Args/fixtures for visual states, network mocking only for
    selected integration-level stories).
  - The exact validation workflow from the goal brief: start Storybook, build the static
    Storybook, render every initial story without a live backend, confirm shared
    fonts/Tailwind/theme tokens, compare representative computed styles, verify desktop and
    mobile layouts, run the `@storybook/addon-vitest` suite.
  - How an agent selects and verifies the relevant story before declaring a UI task
    complete, including that visual consistency must not be claimed from source code or
    Tailwind class names alone — the rendered story (and, where exact values matter,
    computed styles) must be inspected, e.g. via the `mcp__playwright__*` tools already
    available in this environment.
- Cross-link from `docs/development/react-component-guidelines.md` and/or
  `docs/development/ui-ux-guidelines.md` where they currently describe testing/visual
  verification expectations that Storybook now partially fulfills (e.g. the RTL testing line
  in `react-component-guidelines.md:374` — note that Vitest+RTL is now wired, where).

## Constraints

- Follow `tools/docs.mjs`'s required front-matter fields for `type: development` exactly.
- Do not restate content already owned by `docs/development/nevo-ai-ux-guidelines.md` or
  `docs/development/ui-ux-guidelines.md` — link to them instead of duplicating their rules.

## Interfaces and boundaries

- Consumes: real patterns/scripts/paths from areas 2-5 (must not be written before those
  exist, or it will document aspirational rather than actual behavior).
- Consumed by: any future spec/agent adding a new story.

## Area-specific acceptance criteria

1. `node tools/docs.mjs validate` passes for the new/updated document(s).
2. The documented `npm run storybook`/`build-storybook` commands match the actual script
   names defined in `areas/storybook-infrastructure.md`'s implementation.
3. The documented fixture-reuse instructions reference the actual scenario builder module
   path from `areas/chat-stories.md`'s implementation, not a hypothetical one.
4. The documented agent-verification workflow matches `overview.md` § "Verification
   strategy" exactly (no drift between the two).
5. The documented story hierarchy and naming conventions match every story's real
   Storybook `title` as actually implemented across areas 3-5, not an aspirational
   hierarchy that diverges from what was built.

## Dependencies

- `storybook-infrastructure`, `testing-infrastructure`, `foundation-stories`,
  `chat-stories` (needs their final, real shape to document accurately).

## Out of scope

- Any new architectural decision — this area only documents what areas 1-5 already built.
