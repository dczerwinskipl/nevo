import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { AgentSessionChatSurface } from './agent-session-chat-surface';
import { buildEmptyWaitingTurn, buildUserMessage } from './work-v2/__fixtures__/chat-fixtures';

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
    placeholder: 'Zapytaj agenta o cokolwiek lub wpisz polecenie…',
    currentMode: 'edit',
  },
  play: async ({ canvasElement }) => {
    // 1. Verify empty state text matching production transcript V2
    expect(canvasElement.textContent).toContain('Brak wiadomości w sesji');
    expect(canvasElement.textContent).toContain('Wpisz pierwszą wiadomość, aby rozpocząć konwersację z agentem.');

    // 2. Verify zero user message bubbles or work items are rendered
    const userBubbles = canvasElement.querySelectorAll('.rounded-2xl.bg-\\[var\\(--surface-raised\\)\\]');
    expect(userBubbles.length).toBe(0);

    // 3. Verify composer textarea is present and enabled
    const textarea = canvasElement.querySelector('textarea');
    expect(textarea).not.toBeNull();
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

    // 2. Verify Turn Work indicator shows in progress state with 0 actions
    expect(canvasElement.textContent).toContain('Work · 0 actions');
    expect(canvasElement.textContent).toContain('In progress');

    // 3. Verify no commentary, tools, or final answer exist
    expect(canvasElement.textContent).not.toContain('PASS (809 tests)');
    expect(canvasElement.textContent).not.toContain('I have reviewed the test suite');

    // 4. Verify cancel button is accessible while turn is running
    const cancelButton = canvasElement.querySelector('button[aria-label="Przerwij generowanie"]');
    expect(cancelButton).not.toBeNull();
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
