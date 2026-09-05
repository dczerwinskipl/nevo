# Area: react-class-composition-guidelines

## Responsibility

Establish durable, transferable guidelines for React and Tailwind class composition in
`docs/development/react-component-guidelines.md` while separating portable React mechanics
from Nevo-specific UX and AI session semantics. This area restores proper documentation
ownership across `docs/development/` (`ui-ux-guidelines.md`, `nevo-ai-ux-guidelines.md`,
`nevo-interaction-model.md`, `storybook.md`), upgrades `tools/docs.mjs find` with query-based
and path-based documentation discovery, enforces frontmatter discovery metadata, improves
generated documentation indexes, updates documentation routing rules, and corrects
declared documentation contexts across Tasks 03–10.

## Current state

- `docs/development/react-component-guidelines.md` contains component/module architecture
  rules, but previously embedded Nevo-specific status vocabularies (`StatusTone`), specific
  feature-mapping owners, and duplicated checklist content that belongs in generic/product
  guidelines.
- `docs/development/ui-ux-guidelines.md` is the rightful owner of product-level semantic
  presentation vocabulary (neutral, active, success, warning, error, attention, info,
  action-destructive) and their role distinctions.
- `docs/development/nevo-ai-ux-guidelines.md` is the rightful owner of Nevo-specific AI
  and session status mappings (tool failure vs. turn failure vs. attention vs. waiting).
- `docs/development/nevo-interaction-model.md` owns surface placement and disclosure rules.
- `docs/development/storybook.md` owns component verification and visual foundation presentation.
- `tools/docs.mjs find` previously supported only exact `--scope` and `--type`, while scopes
  were unpopulated across the documentation set. Path-based routing and full-text metadata
  query search were missing.
- Generated `docs/index.generated.md` previously rendered a permanently blank "Scopes" column
  instead of concise document summaries.
- Tasks 03–10 declared incomplete documentation contexts that did not match their owning
  documents or the updated frontend routing table.

## Requirements

1. **Portable React Class-Composition Guidance** (`react-component-guidelines.md`):
   - Local static layout (inline in JSX; class list length alone is not an extraction trigger).
   - Reusable component variants with `cva()`, `VariantProps`, and disciplined `compoundVariants`.
   - The generic presentation pipeline:
     `domain state -> semantic presentation -> component variant -> Tailwind utility -> design token`
     without hardcoding Nevo-specific `StatusTone` unions, specific status dictionaries, or
     dashboard file lists into the portable document.
   - Native DOM/ARIA/Radix interaction state selectors over ad-hoc boolean props.
   - `cn()` discipline for conditional inclusion and consumer overrides.
   - Tailwind source-detection constraints: complete static strings; strict ban on dynamic
     interpolation (`` `text-status-${tone}` ``).
   - Multi-slot component recipes: focused local recipes per slot.
   - Boundaries for custom CSS and `@apply` (Markdown, third-party markup, global resets).
   - Component variant and state testing guidelines.
   - Single canonical composition checklist in §11, referenced from §12.
2. **Documentation Ownership and Semantic Vocabulary**:
   - `ui-ux-guidelines.md`: Owns the semantic status vocabulary (neutral, active, success,
     warning, error, attention, info, action-destructive) and role distinctions.
   - `nevo-ai-ux-guidelines.md`: Owns AI session status mappings (tool failure -> warning,
     turn failure -> error, user action -> attention, waiting is not attention).
   - `nevo-interaction-model.md`: Owns surface placement and disclosure.
   - `storybook.md`: Owns visual verification, stories, and design-system foundation presentation.
3. **Documentation Discovery Tooling** (`tools/docs.mjs`, `tools/docs/service.mjs`):
   - `--query <text>`: Normalized, case-insensitive search across ID, title, summary,
     `read_when`, file path, and related IDs. Prioritizes exact matches; provides deterministic
     ordering and structured match metadata in JSON mode.
   - `--path <repository-path>`: Resolves documentation applicable to a concrete repository
     path using `docs/routing.generated.json`, including rule IDs and match reasons.
   - Keep `--scope` backward-compatible; support combined `--query`, `--path`, and `--type`.
4. **Validation and Index Improvements**:
   - Require non-empty `read_when` on `development` and `ai` documents.
   - Provide `read_when` on existing AI docs (`task-routing.md`, `change-impact-map.md`).
   - In `docs/index.generated.md`, replace the empty Scopes column with concise summaries.
5. **Documentation Routing and Navigation Guidance**:
   - Route `tools/dashboard/ui/**` to both `react-component-guidelines.md` and `ui-ux-guidelines.md`.
   - Route `.storybook/**`, `components/ui/**`, `foundations/**` to `storybook.md`.
   - Route `features/agent-sessions/**`, `features/specifications/**`, `features/pull-requests/**`
     to `nevo-ai-ux-guidelines.md` and `nevo-interaction-model.md`.
   - Update testing invariants in `task-routing.md` to specify `test:storybook` for presentation changes.
   - Update `docs/ai/how-to-navigate.md` to explain `--query` and `--path` workflows.
6. **Task Context Corrections (Tasks 03–10)**:
   - Update declared contexts in Tasks 03–10 to include their owning documents and eliminate
     routing warnings. Replace Task 08's unusable `--scope` requirement with concrete
     `--query` and `--path` lookups.

## Constraints

- Documentation and tooling only — no `tools/dashboard/ui/**` source code changes.
- No new external dependencies.

## Acceptance criteria

1. Portable React guidelines in `react-component-guidelines.md` with one canonical checklist.
2. Semantic status vocabulary owned by `ui-ux-guidelines.md`; AI mappings owned by `nevo-ai-ux-guidelines.md`.
3. `tools/docs.mjs find --query` and `--path` implemented and verified by automated tests.
4. Validation enforces `read_when`; `docs/index.generated.md` shows summaries.
5. `task-routing.md` and `how-to-navigate.md` updated and verified.
6. Tasks 03–10 have correct declared contexts and zero routing warnings.
7. `node tools/docs.mjs validate`, `node tools/docs.mjs check`, and `npm test` pass.
