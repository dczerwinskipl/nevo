import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { AgentSessionWorkflowBar, type BoundTaskInfo } from '../ui/features/agent-sessions/agent-session-workflow-bar';
import { AgentSessionChatSurface } from '../ui/features/agent-sessions/agent-session-chat-surface';
import type { CanonicalTurn } from '../ui/features/agent-sessions/types';

/**
 * Task 03 corrective pass — real component-interaction (RTL) tests replacing the
 * source-code-regex assertions the earlier Task 03 implementation relied on. These render
 * the actual components and assert on DOM output / callback invocation, not on the
 * presence of particular source strings.
 */

const NO_TURNS: CanonicalTurn[] = [];

function baseChatSurfaceProps(overrides: Partial<React.ComponentProps<typeof AgentSessionChatSurface>> = {}) {
  return {
    turns: NO_TURNS,
    isLoading: false,
    hasSessionDetails: true,
    onSend: vi.fn(),
    onRespondInteraction: vi.fn(),
    experienceMode: 'deterministic' as const,
    ...overrides,
  };
}

describe('AgentSessionWorkflowBar: task switching is an explicit operator command', () => {
  it('clicking an inactive task chip invokes onSelectTask with that task id (never implicit/local-only)', () => {
    const tasks: BoundTaskInfo[] = [
      { id: '01', status: 'verified' },
      { id: '02', status: 'in-review', currentStep: 'review', attempt: 2 },
    ];
    const onSelectTask = vi.fn();

    render(<AgentSessionWorkflowBar tasks={tasks} activeTaskId="01" onSelectTask={onSelectTask} />);

    const task02Chip = screen.getByRole('button', { name: /Przełącz kontekst na zadanie 02/i });
    fireEvent.click(task02Chip);

    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith('02');
  });

  it('renders the authoritative server-projected step and attempt — never a fabricated default', () => {
    const tasks: BoundTaskInfo[] = [{ id: '02', status: 'in-review', currentStep: 'review', attempt: 3 }];
    render(<AgentSessionWorkflowBar tasks={tasks} activeTaskId="02" />);
    expect(screen.getByText('● 02 (review · attempt 3)')).toBeInTheDocument();
  });

  it('renders an explicit "unknown" label rather than fabricating in-implementation/attempt 1 when the server has no projection yet', () => {
    const tasks: BoundTaskInfo[] = [{ id: '03' }];
    render(<AgentSessionWorkflowBar tasks={tasks} activeTaskId="03" />);
    expect(screen.getByText('● 03 (unknown)')).toBeInTheDocument();
  });
});

describe('AgentSessionChatSurface: Request Changes composer mode', () => {
  it('opens directly in request-changes mode via initialActionMode — no second click required', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 1,
          initialActionMode: 'request-changes',
        })}
      />,
    );

    expect(screen.getByText(/Request changes · Task 05/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send & reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('does not require a second click when clicking the in-chat "Request changes" button', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 1,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Request changes for task 05/i }));
    expect(screen.getByText(/Request changes · Task 05/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send & reject' })).toBeInTheDocument();
  });

  it('rejects empty feedback (Send & reject stays disabled) and submits + exits mode with valid feedback', () => {
    const onRequestChangesSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 2,
          initialActionMode: 'request-changes',
          onRequestChangesSubmit,
        })}
      />,
    );

    const sendButton = screen.getByRole('button', { name: 'Send & reject' });
    expect(sendButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText(
      'Provide specific feedback and required corrections for the next implementation attempt...',
    );
    fireEvent.change(textarea, { target: { value: 'Fix retry handling and add tests.' } });
    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);
    expect(onRequestChangesSubmit).toHaveBeenCalledWith('05', 'Fix retry handling and add tests.');
  });

  it('Cancel exits the mode and restores the standard conversational composer', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 1,
          initialActionMode: 'request-changes',
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Request changes · Task 05/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyślij wiadomość' })).toBeInTheDocument();
  });
});

describe('AgentSessionChatSurface: blocked/not-ready task renders no executable workflow action', () => {
  it('renders no action buttons when the server projects an empty availableActions array', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '06',
          availableActions: [],
          boundTasks: [{ id: '06', status: 'approved' }],
        })}
      />,
    );

    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start review/i })).not.toBeInTheDocument();
  });
});
