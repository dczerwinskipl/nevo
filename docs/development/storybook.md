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
  component tests, and the mandatory agent visual verification workflow.
related:
  - development.react-component-guidelines
  - development.ui-ux-guidelines
  - development.nevo-ai-ux-guidelines
---

# Storybook guidelines and workflows

Storybook provides an isolated, deterministic environment for developing, inspecting, and testing NEvo dashboard UI components without requiring a live backend, database, or AI model provider.

---

## 1. Quick start and scripts

All Storybook commands are defined in `tools/dashboard/package.json`:

```bash
# Start local Storybook development server (default port 6006)
npm --prefix tools/dashboard run storybook

# Build static Storybook bundle to tools/dashboard/.storybook/dist
npm --prefix tools/dashboard run build-storybook

# Run headless Vitest story test suite (via @storybook/addon-vitest in Chromium)
npm --prefix tools/dashboard run test:storybook
```

### Constraints and isolation

1. **Zero production impact:** Storybook and its testing tools are dev-only dependencies. `npm --prefix tools/dashboard run build` (`tsc -b && vite build`) remains completely decoupled from Storybook code.
2. **Identical styling pipeline:** Storybook imports `tools/dashboard/ui/index.css` directly. It uses the exact production Tailwind CSS v4 setup, typography scale, and theme CSS variables (`--background`, `--foreground`, `--accent`, `--muted`, `--border`, etc.).
3. **No dark/light drift:** The dashboard renders unconditionally with dark theme tokens (`index.css:63-77`). Every story renders with matching dark background and text tokens without white flash or mismatched canvas containers.

---

## 2. Story hierarchy and naming conventions

Story titles define the sidebar hierarchy in Storybook. The NEvo dashboard follows this four-tier organization:

| Hierarchy tier | Title pattern | Examples in codebase | Purpose |
|---|---|---|---|
| **Foundations** | `Foundations/<Topic>` | `Foundations/Smoke`<br>`Foundations/Typography`<br>`Foundations/Colors` | Design tokens, color swatches, font size scales, line heights, and smoke sanity tests. |
| **Components** | `Components/<Domain>/<Component>` | *(e.g. `Components/UI/Button`, `Components/UI/StatusCard`)* | Low-level shared primitives and generic presentation components. |
| **Features** | `Features/<Domain>/<Feature>` | `Features/AgentSessions/ChatSurface` | Vertical domain features composing primitives and domain state models. |
| **Screens** | `Screens/<PageName>` | *(e.g. `Screens/AgentSessionPage`, `Screens/SpecificationDetail`)* | Full page views composed with routing and layout contexts. |

### Naming rules

- Story files are co-located with their target components: `<name>.stories.tsx`.
- The default export `Meta` must specify a `title` following the hierarchy above.
- Story exports use PascalCase (e.g., `EmptyChat`, `ExistingConversation`, `ActiveThinking`, `ActiveTool`).
- Mobile breakpoint variants share the base story configuration and append `Mobile` with a viewport parameter:
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
- `buildCompletedConversationTurn(options?)`: Full conversation with user prompt, commentary, tools (read, edit, write, command, search), and final answer.
- `buildActiveRunningTurn(options?)`: Turn actively executing a tool. Matches server `computeCurrentActivity` semantics:
  - When `work` is passed, selects the most recent `active` or `queued` tool.
  - Rejects completed-only `work` without active tools.
  - Automatically excludes all active, queued, and streaming items from `historicalWork` while keeping completed history.
- `buildActiveThinkingTurn(options?)`: Active commentary or reasoning stream. Rejects non-streaming items to guarantee genuine reasoning evidence.
- `buildActiveCommentaryTurn(options?)`: Active streaming commentary turn.
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
   - Pure visual states must not depend on network calls or mock servers.
   - Use MSW or fetch mocks only for integration-level stories testing actual API error recovery or polling transitions.

---

## 5. Testing and verification workflow

Storybook stories serve as automated tests and visual inspection targets.

### Automated testing (`@storybook/addon-vitest`)

Story interactions and accessibility invariants are verified using the story `play` function:

```typescript
export const ActiveTool: Story = {
  args: { /* ... */ },
  play: async ({ canvasElement }) => {
    // Assert elements by accessible roles and text
    const workHeader = canvasElement.querySelector('button[aria-expanded]');
    expect(workHeader).not.toBeNull();
    expect(workHeader!.textContent).toContain('In progress');

    // Verify dynamic behavior and animations
    const spinner = workHeader!.querySelector('svg');
    expect(window.getComputedStyle(spinner!).animationName).toContain('spin');

    // Verify computed style distinctions
    const activeIcon = canvasElement.querySelector('[role="status"] svg');
    const completedIcon = canvasElement.querySelector('button svg');
    expect(window.getComputedStyle(activeIcon!).color).not.toBe(
      window.getComputedStyle(completedIcon!).color
    );
  },
};
```

Run tests with `npm --prefix tools/dashboard run test:storybook`.

---

## 6. Agent visual verification workflow

AI agents and developers must follow this strict verification workflow before declaring any frontend task complete:

1. **Never trust source classes alone:**
   - Visual consistency and alignment must not be asserted merely from Tailwind class names (e.g., `text-[var(--accent)]`, `flex`, `p-4`) or static JSX code.
   - You must verify that the element actually renders, that tokens resolve, and that computed styles produce the intended colors, borders, and layouts.
2. **Execute automated suites:**
   - Run `npm --prefix tools/dashboard test` for unit and component interaction tests.
   - Run `npm --prefix tools/dashboard run test:storybook` for real Chromium-based story execution.
   - Run `npm --prefix tools/dashboard run build` and `npm --prefix tools/dashboard run build-storybook` to guarantee clean production and static storybook packaging.
3. **Visual inspection via browser tools:**
   - When introducing or altering UI components, start Storybook or build it statically.
   - Inspect both desktop (default) and mobile (`mobile1`, 375px width) viewports.
   - Confirm that long text wraps without breaking container boundaries, that expand/collapse toggles update correctly, and that active/completed indicators are visually distinct.
