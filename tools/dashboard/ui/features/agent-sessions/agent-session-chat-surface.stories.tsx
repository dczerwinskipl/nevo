import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { AgentSessionChatSurface } from './agent-session-chat-surface';
import {
  buildEmptyWaitingTurn,
  buildUserMessage,
  buildCompletedConversationTurn,
  buildCommentary,
  buildFileReadTool,
  buildFileEditTool,
  buildFileWriteTool,
  buildSearchTool,
  buildGroupedCommandsScenario,
  buildLongCommentary,
  buildLongCommandTool,
  buildLongPathTool,
  buildFinalAnswer,
} from './work-v2/__fixtures__/chat-fixtures';

const meta: Meta<typeof AgentSessionChatSurface> = {
  title: 'Features/AgentSessions/ChatSurface',
  component: AgentSessionChatSurface,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen w-full flex-col bg-[var(--background)] text-[var(--foreground)]">
        <Story />
      </div>
    ),
  ],
  args: {
    onSend: () => {},
    onRespondInteraction: () => {},
    onCancel: () => {},
    onModeChange: () => {},
    onReload: () => {},
    onBack: () => {},
    onRetryInitial: () => {},
    onDismissError: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof AgentSessionChatSurface>;

/**
 * Story 1: "Empty chat"
 * Matching docs/development/nevo-ai-ux-guidelines.md §4:
 * No conversation history, empty state placeholder, composer ready to send.
 */
export const EmptyChat: Story = {
  args: {
    turns: [],
    isLoading: false,
    hasSessionDetails: true,
    loadError: null,
    isRunning: false,
    canCancel: false,
    isProviderAvailable: true,
    disabled: false,
    currentMode: 'edit',
  },
  play: async ({ canvasElement }) => {
    // 1. Verify empty state text matching production transcript V2
    expect(canvasElement.textContent).toContain('Brak wiadomości w sesji');
    expect(canvasElement.textContent).toContain('Wpisz pierwszą wiadomość, aby rozpocząć konwersację z agentem.');

    // 2. Verify zero user message bubbles or work items are rendered
    const userBubbles = canvasElement.querySelectorAll('.rounded-2xl.bg-\\[var\\(--surface-raised\\)\\]');
    expect(userBubbles.length).toBe(0);

    // 3. Verify composer textarea is present, enabled, and renders the production default placeholder
    const textarea = canvasElement.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.placeholder).toBe('Napisz wiadomość…');
    expect(textarea?.disabled).toBe(false);

    // 4. Verify send button is present
    const sendButton = canvasElement.querySelector('button[aria-label="Wyślij wiadomość"]');
    expect(sendButton).not.toBeNull();
  },
};

/**
 * Story 1 (Mobile viewport): "Empty chat" on narrow screen.
 */
export const EmptyChatMobile: Story = {
  ...EmptyChat,
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

/**
 * Story 2: "Waiting for first agent activity"
 * User message submitted, turn started, no commentary/tool/final response yet.
 * Frozen deterministic snapshot with no live timers or intervals.
 */
export const WaitingForFirstActivity: Story = {
  args: {
    turns: [
      buildEmptyWaitingTurn({
        userMessage: buildUserMessage({
          text: 'Please review the test suite and verify storybook infrastructure.',
        }),
      }),
    ],
    isLoading: false,
    hasSessionDetails: true,
    loadError: null,
    isRunning: true,
    canCancel: true,
    isProviderAvailable: true,
    disabled: true,
    currentMode: 'edit',
  },
  play: async ({ canvasElement }) => {
    // 1. Verify user message is rendered with exact submitted text
    expect(canvasElement.textContent).toContain('Please review the test suite and verify storybook infrastructure.');

    // 2. Verify Turn Work indicator shows waiting for model response and does NOT show Thinking
    expect(canvasElement.textContent).toContain('Waiting for model response');
    expect(canvasElement.textContent).not.toContain('Thinking');

    // 3. Verify Turn Work indicator shows in progress state with 0 actions
    expect(canvasElement.textContent).toContain('Work · 0 actions');
    expect(canvasElement.textContent).toContain('In progress');

    // 4. Verify no commentary, tools, or final answer exist
    expect(canvasElement.textContent).not.toContain('PASS (809 tests)');
    expect(canvasElement.textContent).not.toContain('I have reviewed the test suite');

    // 5. Verify cancel button is accessible while turn is running
    const cancelButton = canvasElement.querySelector('button[aria-label="Przerwij generowanie"]');
    expect(cancelButton).not.toBeNull();

    // 6. Verify composer textarea reflects active turn rather than claiming read-only
    const textarea = canvasElement.querySelector('textarea');
    expect(textarea?.placeholder).toBe('Turn trwa…');
    expect(textarea?.disabled).toBe(true);
  },
};

/**
 * Story 2 (Mobile viewport): "Waiting for first agent activity" on narrow screen.
 */
export const WaitingForFirstActivityMobile: Story = {
  ...WaitingForFirstActivity,
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

/**
 * Story 3: "Existing conversation"
 * A representative user/assistant conversation with a populated Work timeline:
 * - Commentary, command execution, file read, file edit, file write, search
 * - Grouped commands (3 consecutive commands)
 * - Long content: long commentary, long command (>200 chars), long path (>100 chars)
 * - Completed final answer
 * - Fully editable via Storybook Args/Controls
 */
export const ExistingConversation: Story = {
  args: {
    turns: [
      buildCompletedConversationTurn({
        userMessage: buildUserMessage({
          text: 'Please analyze the design tokens and run the test suite to verify dark mode support.',
        }),
        work: [
          buildLongCommentary(),
          buildSearchTool({
            subject: 'color-scheme',
            description: 'Search for "color-scheme" in tools/dashboard/ui',
          }),
          buildFileReadTool({
            subject: 'index.css',
            description: 'tools/dashboard/ui/index.css',
          }),
          ...buildGroupedCommandsScenario(3),
          buildFileEditTool({
            subject: 'colors.stories.tsx',
            description: 'tools/dashboard/ui/foundations/colors.stories.tsx',
          }),
          buildLongCommandTool(),
          buildFileWriteTool({
            subject: 'typography.stories.tsx',
            description: 'tools/dashboard/ui/foundations/typography.stories.tsx',
          }),
          buildLongPathTool(),
        ],
        finalAnswer: buildFinalAnswer({
          text: 'All design tokens and foundation stories have been successfully verified. Dark mode styles and typography inventories are completely covered.',
        }),
      }),
    ],
    isLoading: false,
    hasSessionDetails: true,
    loadError: null,
    isRunning: false,
    canCancel: false,
    isProviderAvailable: true,
    disabled: false,
    currentMode: 'edit',
  },
  play: async ({ canvasElement }) => {
    // 1. Verify user message is rendered with exact submitted text
    expect(canvasElement.textContent).toContain('Please analyze the design tokens and run the test suite');

    // 2. Verify final answer is rendered with expected text
    expect(canvasElement.textContent).toContain('All design tokens and foundation stories have been successfully verified');

    // 3. Verify Turn Work indicator shows completed status and action count (10 actions)
    expect(canvasElement.textContent).toContain('Work · 10 actions');
    expect(canvasElement.textContent).toContain('Completed');

    // 4. Expand Level 2 Work details by clicking the work summary header
    const workHeaderButton = canvasElement.querySelector('button[aria-expanded]');
    expect(workHeaderButton).not.toBeNull();
    if (workHeaderButton && workHeaderButton.getAttribute('aria-expanded') === 'false') {
      await userEvent.click(workHeaderButton);
    }

    // 5. Verify presence of all required activity kinds in expanded timeline
    expect(canvasElement.textContent).toContain('Investigating the performance metrics across all 14 active font-size scales');
    expect(canvasElement.textContent).toContain('Search code');
    expect(canvasElement.textContent).toContain('Read file');
    expect(canvasElement.textContent).toContain('Edit file');
    expect(canvasElement.textContent).toContain('Write file');
    expect(canvasElement.textContent).toContain('Run command');

    // 6. Verify grouped commands row reflects count (3)
    expect(canvasElement.textContent).toContain('(3)');

    // 7. Verify long content is present without layout overflow
    expect(canvasElement.textContent).toContain('very-deeply-nested-subsystem-build-process');
    expect(canvasElement.textContent).toContain('very-deeply-nested-session-transcript-inspection-view');

    // 8. Verify composer is enabled and ready for subsequent input
    const textarea = canvasElement.querySelector('textarea');
    expect(textarea?.placeholder).toBe('Napisz wiadomość…');
    expect(textarea?.disabled).toBe(false);
  },
};

/**
 * Story 3 (Mobile viewport): "Existing conversation" on narrow screen.
 */
export const ExistingConversationMobile: Story = {
  ...ExistingConversation,
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};
