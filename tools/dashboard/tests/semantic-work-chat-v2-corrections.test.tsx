import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentSessionTranscriptV2 } from '../ui/features/agent-sessions/work-v2/agent-session-transcript-v2';
import { TurnWorkPanelV2 } from '../ui/features/agent-sessions/work-v2/turn-work-panel-v2';
import { WorkIndicatorV2 } from '../ui/features/agent-sessions/work-v2/work-indicator-v2';
import { WorkTimelineV2 } from '../ui/features/agent-sessions/work-v2/work-timeline-v2';
import { ConfirmationPrompt } from '../ui/features/agent-sessions/interactions/interaction-prompt';
import { describeCurrentActivityV2 } from '../ui/features/agent-sessions/work-v2/activity-model-v2';
import type {
  AgentConfirmationInteraction,
  CanonicalTurnV2,
  ToolInvocationWorkItemV2,
} from '../ui/features/agent-sessions/types';

describe('V2 Chat Surface Component Tests (RTL renders)', () => {
  it('Requirement 1: UserMessageBubble provides line-clamp-6 and accessible Polish toggle button for long messages', () => {
    const longText = Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`).join('\n');
    const turns: CanonicalTurnV2[] = [
      {
        id: 'turn-1',
        userMessage: {
          id: 'user-1',
          text: longText,
          createdAt: '2026-08-30T10:00:00Z',
        },
        work: [],
        historicalWork: [],
        currentActivity: null,
        activityCount: 0,
        finalAnswer: null,
        status: { status: 'terminal', outcome: 'completed' },
      },
    ];

    render(<AgentSessionTranscriptV2 turns={turns} isLoading={false} hasSessionDetails={true} contentRevision={1} />);

    const toggleButton = screen.getByRole('button', { name: /pokaż więcej/i });
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

    // Click to expand
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveTextContent('Zwiń');
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('Requirement 5: Optimistic state displays neutral Starting… indicator before server turn arrives', () => {
    render(
      <AgentSessionTranscriptV2
        turns={[]}
        optimisticUserMessage="Please check the current spec"
        isLoading={false}
        hasSessionDetails={true}
        contentRevision={1}
      />,
    );

    expect(screen.getByText('Please check the current spec')).toBeInTheDocument();
    expect(screen.getByText('Starting…')).toBeInTheDocument();
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
  });

  it('Gap 4: TurnWorkPanelV2 directly navigates to item details, supports Back to list, and resets on Details click', () => {
    const toolItem: ToolInvocationWorkItemV2 = {
      id: 'tool-item-1',
      seq: 1,
      type: 'tool',
      toolName: 'read_file',
      kind: 'read',
      title: 'Read specification',
      status: 'completed',
      startedAt: '2026-08-30T10:00:00Z',
      completedAt: '2026-08-30T10:00:01Z',
      durationMs: 1000,
      createdAt: '2026-08-30T10:00:00Z',
      updatedAt: '2026-08-30T10:00:01Z',
    };

    const turn: CanonicalTurnV2 = {
      id: 'turn-1',
      work: [toolItem],
      historicalWork: [toolItem],
      currentActivity: null,
      activityCount: 1,
      finalAnswer: null,
      status: { status: 'terminal', outcome: 'completed' },
    };

    render(<TurnWorkPanelV2 turn={turn} onRespondInteraction={vi.fn()} />);

    // Expand Level 2 by clicking the WorkIndicator toggle button
    const indicatorButton = screen.getByRole('button', { name: /work · 1 action · completed/i });
    fireEvent.click(indicatorButton);

    // Direct click on the Level 2 item row opens WorkDetailsSheetV2 directly to that item
    const itemRowButton = screen.getByRole('button', { name: /read specification/i });
    fireEvent.click(itemRowButton);

    // Should render item details with Back button
    const backButton = screen.getByRole('button', { name: /wróć do listy/i });
    expect(backButton).toBeInTheDocument();
    expect(screen.getAllByText('read_file').length).toBeGreaterThan(0);

    // Click back to return to the overview list
    fireEvent.click(backButton);
    expect(screen.getByText('Work Details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wróć do listy/i })).not.toBeInTheDocument();

    // Close the sheet
    const closeButton = screen.getByRole('button', { name: /zamknij/i });
    fireEvent.click(closeButton);

    // Now click the Level 2 "Details" button: should open the overview list, not stale item
    const detailsButton = screen.getByRole('button', { name: /details/i });
    fireEvent.click(detailsButton);
    expect(screen.getByText('Work Details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wróć do listy/i })).not.toBeInTheDocument();
  });

  it('Gap 3: ToolGroupRow renders compound ToolActions nested under their invocation in Level 2', () => {
    const compoundTool: ToolInvocationWorkItemV2 = {
      id: 'tool-compound-1',
      seq: 1,
      type: 'tool',
      toolName: 'composite_runner',
      kind: 'other',
      title: 'Run workspace tasks',
      status: 'completed',
      actions: [
        {
          id: 'action-1',
          seq: 1,
          kind: 'read',
          title: 'Read configuration',
          target: 'specs/overview.md',
          status: 'completed',
        },
        {
          id: 'action-2',
          seq: 2,
          kind: 'execute',
          title: 'Run test suite',
          target: 'npm test',
          status: 'completed',
        },
      ],
      createdAt: '2026-08-30T10:00:00Z',
      updatedAt: '2026-08-30T10:00:01Z',
    };

    render(<WorkTimelineV2 historicalWork={[compoundTool]} onSelectItem={vi.fn()} />);

    expect(screen.getByText('Run workspace tasks')).toBeInTheDocument();
    expect(screen.getByText('Read configuration')).toBeInTheDocument();
    expect(screen.getByText('· specs/overview.md')).toBeInTheDocument();
    expect(screen.getByText('Run test suite')).toBeInTheDocument();
    expect(screen.getByText('· npm test')).toBeInTheDocument();
  });

  it('Gap 5: ConfirmationPrompt renders confirmation details and calls onResolve with decision', () => {
    const interaction: AgentConfirmationInteraction = {
      id: 'conf-1',
      kind: 'confirmation',
      resumePolicy: 'live-operation',
      title: 'Confirm Operation',
      message: 'Are you sure you want to proceed?',
      details: 'This will modify 3 files in the workspace.',
      payload: { modifiedCount: 3 },
    };

    const onResolve = vi.fn();
    const { unmount } = render(<ConfirmationPrompt interaction={interaction} onResolve={onResolve} />);

    expect(screen.getByText('Confirm Operation')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
    expect(screen.getByText('This will modify 3 files in the workspace.')).toBeInTheDocument();
    expect(screen.getByText(/"modifiedCount": 3/)).toBeInTheDocument();

    // Confirm button
    const confirmBtn = screen.getByRole('button', { name: /potwierdź/i });
    fireEvent.click(confirmBtn);
    expect(onResolve).toHaveBeenCalledWith({ confirmed: true, decision: 'confirm' });

    // Cancel button
    const cancelBtn = screen.getByRole('button', { name: /anuluj/i });
    fireEvent.click(cancelBtn);
    expect(onResolve).toHaveBeenCalledWith({ confirmed: false, decision: 'cancel' });

    unmount();
  });

  it('Gap 6: WorkIndicatorV2 handles cancelling and unknown truthfully without spinning loader', () => {
    // Cancelling turn
    const cancellingTurn: CanonicalTurnV2 = {
      id: 'turn-cancelling',
      work: [],
      historicalWork: [],
      currentActivity: null,
      activityCount: 2,
      finalAnswer: null,
      status: {
        status: 'cancelling',
        initiator: 'user',
        requestedAt: '2026-08-30T10:00:00Z',
        since: '2026-08-30T10:00:00Z',
        source: 'runtime',
      },
    };

    const { unmount: unmountCancelling } = render(
      <WorkIndicatorV2 turn={cancellingTurn} expanded={false} onToggle={vi.fn()} />,
    );
    expect(screen.getByText(/cancelling…/i)).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
    unmountCancelling();

    // Unknown status turn
    const unknownTurn: CanonicalTurnV2 = {
      id: 'turn-unknown',
      work: [],
      historicalWork: [],
      currentActivity: null,
      activityCount: 0,
      finalAnswer: null,
      status: {
        status: 'unknown',
        reason: 'lost_connection',
        since: '2026-08-30T10:00:00Z',
        source: 'server',
      },
    };

    const { unmount: unmountUnknown } = render(
      <WorkIndicatorV2 turn={unknownTurn} expanded={false} onToggle={vi.fn()} />,
    );
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
    unmountUnknown();
  });

  it('Gap 7: Active thinking is single-line preview with no duplicate detail string', () => {
    const displayWithText = describeCurrentActivityV2({
      kind: 'thinking',
      text: 'Analyzing the specification requirements and planning edits',
      startedAt: '2026-08-30T10:00:00Z',
    });

    expect(displayWithText).not.toBeNull();
    expect(displayWithText?.label).toBe('Analyzing the specification requirements and planning edits');
    expect(displayWithText?.detail).toBeUndefined();

    const displayEmpty = describeCurrentActivityV2({
      kind: 'thinking',
      startedAt: '2026-08-30T10:00:00Z',
    });
    expect(displayEmpty?.label).toBe('Thinking…');
    expect(displayEmpty?.detail).toBeUndefined();
  });
});
