import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { AgentSessionChatSurface } from './agent-session-chat-surface';
import {
  buildEmptyWaitingTurn,
  buildActiveThinkingTurn,
  buildActiveRunningTurn,
  buildUserMessage,
  buildCompletedConversationTurn,
  buildReasoning,
  buildCommandTool,
  buildFileReadTool,
  buildFileEditTool,
  buildFileWriteTool,
  buildSearchTool,
  buildGroupedCommandsScenario,
  buildLongCommentary,
  buildLongCommandTool,
  buildLongPathTool,
  buildFinalAnswer,
  type WorkItemV2,
} from './work-v2/__fixtures__/chat-fixtures';

const meta: Meta<typeof AgentSessionChatSurface> = {
  title: 'Features/AgentSessions/ChatSurface',
  component: AgentSessionChatSurface,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen w-full flex-col bg-background text-fg-primary">
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

const defaultActivities: WorkItemV2[] = [
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
];

type ExistingConversationStory = StoryObj<
  React.ComponentProps<typeof AgentSessionChatSurface> & {
    activities: WorkItemV2[];
  }
>;

/**
 * Story 3: "Existing conversation"
 * A representative user/assistant conversation with a populated Work timeline:
 * - Commentary, command execution, file read, file edit, file write, search
 * - Grouped commands (3 consecutive commands)
 * - Long content: long commentary, long command (>200 chars), long path (>100 chars)
 * - Completed final answer
 * - Coherent "activities" control (synchronizes work, historicalWork, and activityCount on every render)
 */
export const ExistingConversation: ExistingConversationStory = {
  argTypes: {
    turns: {
      control: false,
    },
    activities: {
      control: 'object',
      description: 'Coherent list of work activities rendered in the completed Turn timeline',
    },
  },
  args: {
    activities: defaultActivities,
    isLoading: false,
    hasSessionDetails: true,
    loadError: null,
    isRunning: false,
    canCancel: false,
    isProviderAvailable: true,
    disabled: false,
    currentMode: 'edit',
  },
  render: (args) => {
    const activities = args.activities ?? defaultActivities;
    const turn = buildCompletedConversationTurn({
      userMessage: buildUserMessage({
        text: 'Please analyze the design tokens and run the test suite to verify dark mode support.',
      }),
      work: activities,
      historicalWork: activities,
      activityCount: activities.length,
      finalAnswer: buildFinalAnswer({
        text: 'All design tokens and foundation stories have been successfully verified. Dark mode styles and typography inventories are completely covered.',
      }),
    });

    const { activities: _activities, ...surfaceProps } = args;
    return <AgentSessionChatSurface {...surfaceProps} turns={[turn]} />;
  },
  play: async ({ canvasElement }) => {
    // 1. Verify user message is rendered with exact submitted text
    expect(canvasElement.textContent).toContain('Please analyze the design tokens and run the test suite');

    // 2. Verify final answer is rendered with expected text
    expect(canvasElement.textContent).toContain(
      'All design tokens and foundation stories have been successfully verified',
    );

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
    expect(canvasElement.textContent).toContain(
      'Investigating the performance metrics across all 14 active font-size scales',
    );
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
export const ExistingConversationMobile: ExistingConversationStory = {
  ...ExistingConversation,
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

/**
 * Story 4: "Active thinking"
 * Active thinking / commentary currently active, frozen for visual inspection.
 * - Genuine reasoning work item with status 'streaming'
 * - Active turn with currentActivity kind 'thinking'
 * - Composer displays 'Turn trwa…' and textarea is disabled
 * - Stop / Cancel button is available (canCancel: true)
 */
export const ActiveThinking: Story = {
  args: {
    turns: [
      buildActiveThinkingTurn({
        userMessage: buildUserMessage({
          text: 'Analyze our performance telemetry and summarize recent execution trends.',
        }),
        item: buildReasoning({
          status: 'streaming',
          text: 'Evaluating architectural boundaries, performance metrics, and testing infrastructure…',
        }),
      }),
    ],
    isLoading: false,
    hasSessionDetails: true,
    loadError: null,
    isRunning: true,
    canCancel: true,
    isProviderAvailable: true,
    disabled: false,
    currentMode: 'agent',
  },
  play: async ({ canvasElement }) => {
    // 1. Verify user message is rendered
    expect(canvasElement.textContent).toContain('Analyze our performance telemetry');

    // 2. Verify active thinking state is visible with genuine reasoning evidence
    expect(canvasElement.textContent).toContain('Evaluating architectural boundaries');
    expect(canvasElement.textContent).toContain('In progress');

    // 3. Verify composer placeholder reflects running turn and textarea is disabled
    const textarea = canvasElement.querySelector('textarea');
    expect(textarea?.placeholder).toBe('Turn trwa…');
    expect(textarea?.disabled).toBe(true);

    // 4. Verify cancel / stop affordance is present
    const stopButton = canvasElement.querySelector('button[aria-label="Przerwij generowanie"]');
    expect(stopButton).not.toBeNull();
  },
};

/**
 * Story 4 (Mobile viewport): "Active thinking" on narrow screen.
 */
export const ActiveThinkingMobile: Story = {
  ...ActiveThinking,
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

/**
 * Story 5: "Active tool"
 * A tool currently running with running indicator / intermediate styling,
 * visually distinguishable from a completed tool.
 * - Completed historical command tool followed by an active file-read tool
 * - Level 1 reflects running state and active activity title
 * - Composer displays 'Turn trwa…' and textarea is disabled
 * - Stop / Cancel button is available (canCancel: true)
 */
export const ActiveTool: Story = {
  args: {
    turns: [
      buildActiveRunningTurn({
        userMessage: buildUserMessage({
          text: 'Review the story definitions and verify all active states.',
        }),
        work: [
          buildCommandTool({
            status: 'completed',
            subject: 'git status --porcelain',
            description: 'Check working tree status before running build',
          }),
          buildFileReadTool({
            status: 'active',
            subject: 'agent-session-chat-surface.stories.tsx',
            description: 'tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.stories.tsx',
          }),
        ],
      }),
    ],
    isLoading: false,
    hasSessionDetails: true,
    loadError: null,
    isRunning: true,
    canCancel: true,
    isProviderAvailable: true,
    disabled: false,
    currentMode: 'agent',
  },
  play: async ({ canvasElement }) => {
    // 1. Verify user message is rendered
    expect(canvasElement.textContent).toContain('Review the story definitions');

    // 2. Verify Work header explicitly says "In progress"
    const workHeaderButton = canvasElement.querySelector('button[aria-expanded]');
    expect(workHeaderButton).not.toBeNull();
    expect(workHeaderButton!.textContent).toContain('In progress');

    // 3. Verify running spinner is present and has active spin animation
    const headerSpinner = workHeaderButton!.querySelector('svg');
    expect(headerSpinner).not.toBeNull();
    const spinnerStyle = window.getComputedStyle(headerSpinner!);
    const animationName = spinnerStyle.animationName.toLowerCase();
    const animation = spinnerStyle.animation.toLowerCase();
    expect(animationName.includes('spin') || animation.includes('spin')).toBe(true);
    expect(spinnerStyle.animationPlayState).not.toBe('paused');

    // 4. Verify active file-read appears in the current-activity element with role="status"
    const currentActivityStatusEl = canvasElement.querySelector('[role="status"]');
    expect(currentActivityStatusEl).not.toBeNull();
    expect(currentActivityStatusEl!.textContent).toContain('Read file');
    expect(currentActivityStatusEl!.textContent).toContain('agent-session-chat-surface.stories.tsx');

    // 5. Expand Level 2 Work details to inspect historical work
    if (workHeaderButton && workHeaderButton.getAttribute('aria-expanded') === 'false') {
      await userEvent.click(workHeaderButton);
    }

    // 6. Verify completed command appears as a separate historical row
    const historicalRow = Array.from(canvasElement.querySelectorAll('button')).find(
      (btn) => btn !== workHeaderButton && btn.textContent?.includes('git status --porcelain'),
    );
    expect(historicalRow).toBeDefined();
    expect(historicalRow!.textContent).toContain('Run command');
    expect(historicalRow!.textContent).toContain('git status --porcelain');

    // 7. Verify computed icon colors distinguish the active activity from the completed activity
    const activeToolIcon = canvasElement.querySelector('[role="status"] svg');
    expect(activeToolIcon).not.toBeNull();
    const activeIconColor = window.getComputedStyle(activeToolIcon!).color;

    const completedToolIcon = historicalRow!.querySelector('svg');
    expect(completedToolIcon).not.toBeNull();
    const completedIconColor = window.getComputedStyle(completedToolIcon!).color;

    expect(activeIconColor).toBeTruthy();
    expect(completedIconColor).toBeTruthy();
    expect(activeIconColor).not.toBe(completedIconColor);

    // 8. Verify composer placeholder reflects running turn and textarea is disabled
    const textarea = canvasElement.querySelector('textarea');
    expect(textarea?.placeholder).toBe('Turn trwa…');
    expect(textarea?.disabled).toBe(true);

    // 9. Verify cancel / stop affordance is present
    const stopButton = canvasElement.querySelector('button[aria-label="Przerwij generowanie"]');
    expect(stopButton).not.toBeNull();
  },
};

/**
 * Story 5 (Mobile viewport): "Active tool" on narrow screen.
 */
export const ActiveToolMobile: Story = {
  ...ActiveTool,
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};
