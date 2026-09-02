# Area: foundation-stories

## Responsibility

Document the dashboard's actual production typography and color tokens as Storybook
foundation stories, rendering real values — not an aspirational or parallel palette.

## Current state

All tokens live in `tools/dashboard/ui/index.css` as CSS custom properties (see
`overview.md` § "Current architecture" for the full inventory: neutral surfaces, accent,
semantic state colors, lane/category colors, `index.css:6-51`). Font is `Inter` by name only
with no bundled loading mechanism (`index.css:52`, no `@font-face` anywhere). There is no
Tailwind JS config with a `theme.extend` object (Tailwind v4 CSS-first config) and no
existing typography scale constants in code — `docs/development/ui-ux-guidelines.md` §3.1's
typography/weight scale tables are documented as *provisional target direction*, not
necessarily what's implemented; this area's stories must render what the code actually
produces today, and note explicitly where it diverges from that guide (per the guide's own
"Token transition rule", §16).

## Requirements

Typography stories:
- Font family as actually declared (`index.css:52`), rendered, with an explicit note that no
  `@font-face`/bundling exists (so the story documents current reality, including the
  fallback-font risk, rather than asserting Inter always renders).
- Every font size / line-height / weight actually used across the codebase's Tailwind
  utility classes (survey `features/` and `components/ui/` for the utility classes in
  active use, e.g. `text-sm`, `font-semibold`) rendered side by side with the utility class
  name that produces it, and cross-referenced against `docs/development/ui-ux-guidelines.md` §3.1's semantic token table (`text-page-title`, `text-body`, etc.) — noting
  which of those semantic names, if any, already correspond to a real token/utility versus
  which are still aspirational per the guide's own normative language rules.

Color stories:
- Every token in `index.css:6-51` (backgrounds/surfaces, text/foreground, borders,
  accent/primary, semantic status `success`/`warning`/`danger`/`info`, lane colors) rendered
  as a swatch with its custom-property name and resolved value.
- Since only one theme exists (`color-scheme: dark`, no toggle), the story documents this
  explicitly rather than fabricating a light-theme variant.

## Constraints

- No token or palette introduced in these stories may be new/aspirational — every rendered
  value must trace to an existing `index.css` custom property or an actually-used Tailwind
  utility class, cited by file:line in the story's own docs (`@storybook/addon-docs` MDX or
  doc-block comments).
- Reuse the real `index.css` import from `.storybook/preview.ts(x)` (established by
  `areas/storybook-infrastructure.md`) — do not inline copied CSS variable values into the
  story.

## Interfaces and boundaries

- Consumes: `.storybook/main.ts`/`preview.ts(x)` from `areas/storybook-infrastructure.md`.
- Consumed by: nothing downstream in this change: foundation stories are a leaf.

## Area-specific acceptance criteria

1. Every semantic color token in `index.css:6-51` appears in a color foundation story with
   its custom-property name and resolved value visible.
2. The typography story renders the real font stack and every font-size/weight/line-height
   combination actually in use, each labeled with the Tailwind utility/class that produces
   it.
3. The story's documented values match `index.css`'s current values exactly (`inspection:
   diff each rendered value against the current index.css custom property`).
4. A representative computed style (e.g. `--success` resolved color) is identical between
   the story and the production app when inspected via computed styles (not just the source
   literal) — reuses the verification approach `areas/storybook-infrastructure.md` already
   establishes.

## Dependencies

- `storybook-infrastructure`.

## Out of scope

- Any component-level (button, card, etc.) stories — foundations only (raw tokens).
- Redesigning or adding new tokens not already present in `index.css`.
