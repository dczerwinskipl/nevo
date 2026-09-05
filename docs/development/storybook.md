---
id: development.storybook
type: development
title: Storybook guidelines and workflows
status: current
read_when:
  - creating, editing, or inspecting Storybook stories
  - verifying UI components visually or running component tests
  - working with deterministic UI fixtures or chat surface stories
  - changing typography, design tokens, or frontend styling foundations
summary: >
  Guide to Storybook for the NEvo dashboard: running locally, static builds, story hierarchy
  and naming conventions, fixture and scenario reuse, state management patterns, Vitest
  test projects, and the mandatory agent visual verification workflow.
related:
  - development.dashboard-frontend-architecture
  - development.react-component-guidelines
  - development.ui-ux-guidelines
  - development.nevo-ai-ux-guidelines
---

# Storybook guidelines and workflows

Storybook provides an isolated, deterministic environment for developing, inspecting, and testing NEvo dashboard UI components without requiring a live backend, database, or AI model provider.

---

## 1. Quick start and scripts

All frontend test and Storybook commands are defined in `tools/dashboard/package.json`:

```bash
# Run Node.js test runner suite (*.test.mjs) for server, API, and serialization tests
npm --prefix tools/dashboard test

# Start local Storybook development server (default port 6006)
npm --prefix tools/dashboard run storybook

# Build static Storybook bundle to tools/dashboard/.storybook/dist
npm --prefix tools/dashboard run build-storybook

# Run both Vitest projects (jsdom unit tests and Chromium Storybook tests)
npm --prefix tools/dashboard run test:storybook
```

### Tooling and environment architecture

1. **Vitest configuration:** Vitest is configured in `tools/dashboard/vitest.config.ts`. It defines two projects:
   - `unit`: runs fast, isolated DOM tests (`tests/**/*.test.tsx`) in a `jsdom` environment. Setup and cleanup helpers are imported from `.storybook/vitest.setup.ts`.
   - `storybook`: runs `@storybook/addon-vitest` to render stories and execute story `play` interaction functions in a real headless Chromium browser instance powered by `@vitest/browser-playwright`.
2. **Node test suite:** `npm --prefix tools/dashboard test` executes the Node test runner (`node --test`) across `tests/*.test.mjs`, covering backend routes, services, and event streaming.
3. **Zero production impact:** Storybook, Vitest, and browser testing tools are dev-only dependencies. `npm --prefix tools/dashboard run build` (`tsc -b && vite build`) remains completely decoupled from Storybook code.
4. **Identical styling pipeline:** Storybook imports `tools/dashboard/ui/index.css` directly in `.storybook/preview.tsx`. It uses the exact production Tailwind CSS v4 pipeline, typography scale, and theme CSS variables (`--background`, `--foreground`, `--accent`, `--muted`, `--border`, etc.).
5. **No dark/light drift:** The dashboard renders with dark theme tokens unconditionally on `html` and `body`. Every story renders with matching dark background and text tokens without white flash or mismatched canvas containers.

---

## 2. Story hierarchy and naming conventions

Story titles define the sidebar hierarchy in Storybook. The NEvo dashboard follows this organization matching the component taxonomy defined in [dashboard-frontend-architecture.md](dashboard-frontend-architecture.md):

| Hierarchy tier | Title pattern | Current status in codebase | Purpose |
|---|---|---|---|
| **Foundations** | `Foundations/<Topic>` | Implemented: `Foundations/Colors`<br>`Foundations/Typography`<br>`Foundations/Smoke`<br>`Foundations/TokenResolver` | Design tokens, color swatches, font size scales, line heights, live token resolution tests, and smoke sanity tests. |
| **Shared UI** | `Shared/UI/<Component>` | Implemented: `Shared/UI/Button`<br>`Shared/UI/Badge`<br>`Shared/UI/Card`<br>`Shared/UI/Dialog`<br>`Shared/UI/Sheet`<br>`Shared/UI/StatusCard`<br>`Shared/UI/Progress`<br>`Shared/UI/LoadingScreen` | Low-level domain-agnostic UI primitives and presentation components. |
| **Features** | `Features/<Domain>/<Component>` | Implemented: `Features/Agent Sessions/*`<br>`Features/Specifications/*`<br>`Features/Pull Requests/*`<br>`Features/Operations/*` | Vertical domain features composing primitives, domain state models, and scenarios. |
| **Screens** | `Screens/<PageName>` | *Reserved convention for future stories* | Full page views composed with routing and layout contexts. |

### Story co-location and ownership rules

- **Co-location:** Story files are strictly co-located with their target components: `<component-name>.stories.tsx` directly beside `<component-name>.tsx`. Omnibus story files bundling multiple components together are prohibited.
- **Title convention:** The default export `Meta` must specify a `title` following the taxonomy above (`Shared/UI/*`, `Features/<Domain>/*`, `Foundations/*`).
- **Story exports:** Story exports use PascalCase (e.g., `EmptyChat`, `ExistingConversation`, `ActiveThinking`, `ActiveTool`).
- **Test utilities isolation:** All Storybook testing utilities, color calculation helpers, and DOM interaction helpers reside in `tools/dashboard/.storybook/test-utils/` and are imported via `@storybook-test-utils`. Test utilities must never be placed in production component directories.
- **Mobile breakpoint variants:** Mobile variants share the base story configuration and append `Mobile` with a viewport parameter:
  ```typescript
  export const ActiveToolMobile: Story = {
    ...ActiveTool,
    parameters: {
      viewport: {
        defaultViewport: 'mobile1',
      },
    },
  };
  ```

---

## 3. Fixture and scenario model reuse

To avoid duplicating large state trees and protocol objects across stories, scenario data is constructed using typed fixture factories located in:

```text
tools/dashboard/ui/features/agent-sessions/work-v2/__fixtures__/chat-fixtures.ts
```

### Canonical model rules

- All chat and Work scenarios use the canonical UI-facing domain model (`CanonicalTurnV2`, `WorkItemV2`, `ToolKindV2`, `ToolStatusV2`) from `tools/dashboard/ui/features/agent-sessions/types.ts`.
- Raw provider protocol payloads (Anthropic, OpenAI, Codex, Antigravity) are strictly forbidden in story fixtures.

### Available scenario factories

- `buildEmptyWaitingTurn(options?)`: User message submitted, turn status `waiting`, zero activities, clean empty timeline.
- `buildCompletedConversationTurn(options?)`: Full conversation defaults to commentary, file read, command, and final answer. Richer edit/write/search activity is supplied by the `ExistingConversation` story.
- `buildActiveRunningTurn(options?)`: Turn actively executing a tool. Matches server `computeCurrentActivity` semantics:
  - When `work` is passed, selects the most recent `active` or `queued` tool.
  - Rejects completed-only `work` without active tools.
  - Automatically excludes all active, queued, and streaming items from `historicalWork` while keeping completed history.
- `buildActiveThinkingTurn(options?)`: Active commentary or reasoning stream. Rejects non-streaming items. When `work` is passed, follows canonical production precedence (streaming reasoning first, then streaming commentary) and enforces that any passed `item` is present in `work` and matches precedence.
- `buildActiveCommentaryTurn(options?)`: Active streaming commentary turn, ensuring its active commentary is included in `work`.
- Specialized tool builders: `buildCommandTool`, `buildFileReadTool`, `buildFileEditTool`, `buildFileWriteTool`, `buildSearchTool`, `buildLongCommandTool`, `buildLongPathTool`, `buildLongCommentary`, `buildGroupedCommandsScenario`.

---

## 4. State management: Args vs. decorators vs. network mocking

When creating or updating stories, adhere to this state strategy:

1. **Direct Args (Primary / Standard):**
   - Presentational and visual components must be driven via top-level `args` and Storybook Controls.
   - For complex nested collections (such as `WorkItemV2[]`), expose a coherent top-level arg (e.g. `activities: { control: 'object' }`) and synchronize derived fields in the story `render` function. Disable competing raw controls if they permit stale state drift.
2. **Decorators & Context Providers (When Justified):**
   - Use decorators only for essential environment providers: routing contexts (`@tanstack/react-router`), query clients (`QueryClientProvider`), or global viewport framing (`<div className="h-screen w-full flex-col ...">`).
   - Do not wrap pure components in redundant global providers if they take direct props.
3. **Network Mocking (Integration Only):**
   - MSW (Mock Service Worker) is not currently installed or configured. Current visual stories rely strictly on Args and deterministic fixtures.
   - If a future integration-level story genuinely requires network mocking, obtain owner approval for the external dependency first and prefer MSW over custom fetch interception.

---

## 5. Testing and verification workflow

Storybook stories serve as automated tests and visual inspection targets.

### Automated testing (`@storybook/addon-vitest`)

Story interactions and accessibility invariants are verified using the story `play` function in `tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.stories.tsx`:

```typescript
export const ActiveTool: Story = {
  args: { /* ... */ },
  play: async ({ canvasElement }) => {
    // 1. Verify Work header explicitly says "In progress"
    const workHeaderButton = canvasElement.querySelector('button[aria-expanded]');
    expect(workHeaderButton).not.toBeNull();
    expect(workHeaderButton!.textContent).toContain('In progress');

    // 2. Verify running spinner is present and has active spin animation
    const headerSpinner = workHeaderButton!.querySelector('svg');
    expect(headerSpinner).not.toBeNull();
    expect(window.getComputedStyle(headerSpinner!).animationName.toLowerCase()).toContain('spin');

    // 3. Verify active file-read appears in the current-activity element with role="status"
    const currentActivity = canvasElement.querySelector('[role="status"]');
    expect(currentActivity).not.toBeNull();
    expect(currentActivity!.textContent).toContain('Read file');

    // 4. Expand Level 2 Work details
    if (workHeaderButton?.getAttribute('aria-expanded') === 'false') {
      await userEvent.click(workHeaderButton);
    }

    // 5. Look up the specific historical command row by command text
    const historicalRow = Array.from(canvasElement.querySelectorAll('button')).find(
      (btn) => btn !== workHeaderButton && btn.textContent?.includes('git status --porcelain')
    );
    expect(historicalRow).toBeDefined();

    // 6. Verify computed icon colors distinguish active activity from completed activity
    const activeToolIcon = canvasElement.querySelector('[role="status"] svg');
    const completedToolIcon = historicalRow!.querySelector('svg');
    expect(window.getComputedStyle(activeToolIcon!).color).not.toBe(
      window.getComputedStyle(completedToolIcon!).color
    );
  },
};
```

Run tests with `npm --prefix tools/dashboard run test:storybook`.

---

## 6. Agent visual verification workflow

AI agents and developers must follow the verification workflow outlined in the change overview before declaring any frontend task complete:

1. **Render every affected story without a backend:**
   - Verify that all foundation, feature, and interaction stories render cleanly in isolation without requiring a live server or provider.
2. **Run browser and unit tests:**
   - Run `npm --prefix tools/dashboard run test:storybook` to execute the full Vitest suite (both `unit` in jsdom and `storybook` in Chromium).
   - Ensure all assertions, interactions, and accessibility checks pass.
3. **Inspect relevant desktop and mobile variants:**
   - Inspect both desktop (fullscreen) and mobile (`mobile1`, 375px width) viewports using Storybook's viewport controls or browser tools.
   - Confirm layout stability, text wrapping, and responsiveness across breakpoints.
4. **Inspect computed styles when exact visual values matter:**
   - Do not claim visual consistency from source code or Tailwind class names alone.
   - When exact colors, spacing, borders, or animations matter, inspect the computed styles (`window.getComputedStyle`) on rendered DOM elements.
   - No archived screenshot artifact is required as part of normal task completion.
