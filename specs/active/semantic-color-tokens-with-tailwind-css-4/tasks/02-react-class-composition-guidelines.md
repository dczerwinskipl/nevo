---
id: semantic-color-tokens-with-tailwind-css-4.react-class-composition-guidelines
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/react-class-composition-guidelines.md
    - docs/development/react-component-guidelines.md
    - docs/development/ui-ux-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
    - docs/development/nevo-interaction-model.md
    - docs/development/storybook.md
    - docs/ai/task-routing.md
    - docs/ai/how-to-navigate.md
    - docs/ai/change-impact-map.md
    - tools/docs.mjs
    - tools/docs/service.mjs
allowed_paths:
  - docs/development/react-component-guidelines.md
  - docs/development/ui-ux-guidelines.md
  - docs/development/nevo-ai-ux-guidelines.md
  - docs/development/nevo-interaction-model.md
  - docs/development/storybook.md
  - docs/ai/task-routing.md
  - docs/ai/how-to-navigate.md
  - docs/ai/change-impact-map.md
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
  - tools/docs.mjs
  - tools/docs/**
  - tools/tests/docs-discovery.test.mjs
  - tools/tests/docs-routing.test.mjs
  - specs/active/semantic-color-tokens-with-tailwind-css-4/tasks/**
  - specs/active/semantic-color-tokens-with-tailwind-css-4/change.yaml
  - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/react-class-composition-guidelines.md
  - specs/index.generated.json
  - specs/active.generated.md
forbidden_paths:
  - tools/dashboard/ui/**
  - src/**
semantic_references:
  decisions: [D8]
  constraints: [C8]
---

# Task: Transferable React composition guidelines and documentation discovery

## Goal

Broaden and correct Task 02 to:
1. Establish transferable, generic React and Tailwind class-composition guidelines in `docs/development/react-component-guidelines.md` while separating portable React mechanics from Nevo-specific UX semantics.
2. Restore clear documentation ownership across `docs/development/` (`ui-ux-guidelines.md` for semantic presentation vocabulary, `nevo-ai-ux-guidelines.md` for AI/session mappings, `nevo-interaction-model.md` for placement/interaction, and `storybook.md` for visual testing).
3. Enhance `tools/docs.mjs find` with deterministic query-based search (`--query`) across metadata and path-based routing resolution (`--path`) using `docs/routing.generated.json`.
4. Strengthen documentation frontmatter validation (requiring non-empty `read_when` on `development` and `ai` docs) and replace the empty Scopes column in `docs/index.generated.md` with concise summaries.
5. Update `docs/ai/task-routing.md` frontend routing rules and testing requirements; update `docs/ai/how-to-navigate.md` with discovery workflow guidance.
6. Correct declared documentation contexts in Tasks 03–10.

## Dependencies

`frontend-formatter-baseline` (Task 01 verified).

## Implementation constraints

- `react-component-guidelines.md`:
  - Must remain portable and transferable to other React and Tailwind projects.
  - Owns generic implementation guidance (local layout, `cva`, `VariantProps`, compoundVariants, `cn()`, native DOM/ARIA state, multi-slot recipes, Tailwind source-detection constraints without dynamic string interpolation, `@apply` boundaries, component testing, and the generic pipeline `domain state -> semantic presentation -> component variant -> Tailwind utility -> design token`).
  - Must not contain Nevo-specific policy, the literal Nevo `StatusTone` union, specific dashboard status mappings, or stale file references.
  - Keeps one canonical checklist in §11; removes duplicate checklists.
- `ui-ux-guidelines.md`:
  - Owns reusable semantic presentation vocabulary (neutral, active, success, warning, error, attention, info, action-destructive vs status-error) and their distinct product-level meanings.
- `nevo-ai-ux-guidelines.md`:
  - Owns Nevo-specific AI and session status mappings (recoverable tool failure -> warning, failed turn -> error, required user action -> attention, waiting is not attention, active processing vs info).
- `nevo-interaction-model.md` and `storybook.md`:
  - Maintain their designated boundaries (placement/interaction vs visual catalog/verification).
- `tools/docs.mjs find`:
  - Support `--query <text>` normalized across ID, title, summary, `read_when`, file path, and related IDs with deterministic prioritized ordering.
  - Support `--path <repository-path>` matching routing rules from `docs/routing.generated.json` and returning structured match reasons and rule IDs.
  - Keep `--scope` backward compatible; allow combinations of `--query`, `--path`, and `--type`.
- Frontmatter validation:
  - Enforce non-empty `read_when` array of non-empty strings on `development` and `ai` documents.
  - Add missing `read_when` to `docs/ai/task-routing.md` and `docs/ai/change-impact-map.md`.
- `docs/index.generated.md`:
  - Replace permanently empty Scopes column with concise document summary.
- Tasks 03–10:
  - Update `context.required` to include designated owner documents and eliminate routing warnings.
  - Replace Task 08's unusable `--scope` requirement with concrete `--query` and `--path` commands.

## Acceptance criteria

1. `react-component-guidelines.md` contains portable React and Tailwind composition guidance with one canonical checklist and no Nevo-specific status vocabularies or mapping helpers.
2. `ui-ux-guidelines.md` defines the semantic presentation vocabulary and status distinctions without duplicating React implementation mechanics.
3. `nevo-ai-ux-guidelines.md` defines Nevo AI/session status mappings consistently with `ui-ux-guidelines.md`.
4. `tools/docs.mjs find --query` searches normalized terms deterministically across metadata fields; `--path` resolves routing rules with reasons.
5. `tools/docs.mjs validate` enforces non-empty `read_when` for development and AI docs; `docs/index.generated.md` displays concise summaries instead of empty scopes.
6. `docs/ai/task-routing.md` routes dashboard paths to their owning documents and specifies `npm --prefix tools/dashboard run test:storybook` for presentation/component changes; `docs/ai/how-to-navigate.md` documents `--query` and `--path` discovery.
7. Tasks 03–10 have their declared context updated to match their owning documents and pass `specs.mjs context` with zero unresolved routing warnings.
8. Automated tests in `tools/tests/docs-discovery.test.mjs` and `tools/tests/docs-routing.test.mjs` pass.
9. `node tools/docs.mjs validate`, `node tools/docs.mjs check`, and `npm test` pass.
10. No files under `tools/dashboard/ui/**` or `src/**` are modified.

## Verification

```text
node tools/docs.mjs generate
node tools/docs.mjs validate
node tools/docs.mjs check
node --test tools/tests/docs-routing.test.mjs tools/tests/docs-discovery.test.mjs
npm test
```

## Documentation impact

Updates durable React guidelines, UI/UX guidelines, AI UX guidelines, task routing, navigation guidance, and documentation indexes.

## Out of scope

- Implementing semantic color tokens in `tools/dashboard/ui/index.css` (Task 03).
- Component migration in `tools/dashboard/ui/**` (Tasks 04–07).
- Inventing a new scope taxonomy.
