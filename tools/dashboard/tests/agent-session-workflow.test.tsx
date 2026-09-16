import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { AgentSessionWorkflowBar, type BoundTaskInfo } from '../ui/features/agent-sessions/agent-session-workflow-bar';
import { AgentSessionChatSurface } from '../ui/features/agent-sessions/agent-session-chat-surface';
import { SpecificationMetadataFields } from '../ui/screens/specification-console/create-specification/specification-metadata-fields';
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
    isDeterministic: true,
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
    render(<AgentSessionWorkflowBar tasks={tasks} activeTaskId="02" isDeterministic />);
    expect(screen.getByText('● 02 (review · attempt 3)')).toBeInTheDocument();
  });

  it('renders an explicit "unknown" label rather than fabricating in-implementation/attempt 1 when the server has no projection yet', () => {
    const tasks: BoundTaskInfo[] = [{ id: '03' }];
    render(<AgentSessionWorkflowBar tasks={tasks} activeTaskId="03" isDeterministic />);
    expect(screen.getByText('● 03 (unknown)')).toBeInTheDocument();
  });
});

describe('AgentSessionWorkflowBar: legacy specifications never show fabricated deterministic state (D15)', () => {
  it('renders a plain identity/title task-context selector — no status, no attempt, no "(unknown)"', () => {
    const tasks: BoundTaskInfo[] = [
      { id: 'task-a', title: 'Wire up auth' },
      { id: 'task-b', title: 'Add tests' },
    ];
    const onSelectTask = vi.fn();
    render(
      <AgentSessionWorkflowBar tasks={tasks} activeTaskId="task-a" onSelectTask={onSelectTask} isDeterministic={false} />,
    );

    expect(screen.getByText('task-a · Wire up auth')).toBeInTheDocument();
    expect(screen.getByText('task-b · Add tests')).toBeInTheDocument();
    expect(screen.queryByText(/unknown/)).not.toBeInTheDocument();
    expect(screen.getByText('Kontekst:')).toBeInTheDocument();

    // Task switching remains available in a legacy multi-task session.
    fireEvent.click(screen.getByRole('button', { name: /Przełącz kontekst na zadanie task-b/i }));
    expect(onSelectTask).toHaveBeenCalledWith('task-b');
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

describe('AgentSessionChatSurface: session inheritance — isDeterministic is specification-owned (D15)', () => {
  it('a legacy session (isDeterministic=false) never renders the verification banner or availableActions dispatch buttons, even if the server data were present', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          isDeterministic: false,
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 3,
          boundTasks: [{ id: '05', title: 'Legacy task' }],
        })}
      />,
    );

    expect(screen.queryByText(/Human verification/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request changes for task/i })).not.toBeInTheDocument();
    // The plain task-context selector still renders.
    expect(screen.getByText('05 · Legacy task')).toBeInTheDocument();
  });

  it('a deterministic session (isDeterministic=true) renders the verification banner from server-projected availableActions', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          isDeterministic: true,
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 3,
          boundTasks: [{ id: '05', status: 'in-review', currentStep: 'human-verification', attempt: 3 }],
        })}
      />,
    );

    expect(screen.getByText(/Human verification/)).toBeInTheDocument();
    expect(screen.getByText(/Attempt 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve task 05/i })).toBeInTheDocument();
  });
});

describe('AgentSessionChatSurface: Request Changes failure preserves feedback and mode', () => {
  it('a rejected submission keeps the typed feedback in the composer and stays in request-changes mode', async () => {
    const onRequestChangesSubmit = vi.fn().mockRejectedValue(new Error('Server rejected the request'));
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 1,
          initialActionMode: 'request-changes',
          onRequestChangesSubmit,
        })}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      'Provide specific feedback and required corrections for the next implementation attempt...',
    );
    fireEvent.change(textarea, { target: { value: 'Fix retry handling.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send & reject' }));

    // Wait for the rejected promise to settle.
    await vi.waitFor(() => expect(onRequestChangesSubmit).toHaveBeenCalledWith('05', 'Fix retry handling.'));

    // Mode stays active and the typed feedback is never cleared on failure.
    expect(screen.getByText(/Request changes · Task 05/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fix retry handling.')).toBeInTheDocument();
  });

  it('a successful submission clears the feedback and exits request-changes mode', async () => {
    const onRequestChangesSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '05',
          availableActions: ['approve', 'request-changes'],
          activeTaskAttempt: 1,
          initialActionMode: 'request-changes',
          onRequestChangesSubmit,
        })}
      />,
    );

    const textarea = screen.getByPlaceholderText(
      'Provide specific feedback and required corrections for the next implementation attempt...',
    );
    fireEvent.change(textarea, { target: { value: 'Looks fine now.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send & reject' }));

    await vi.waitFor(() => expect(onRequestChangesSubmit).toHaveBeenCalledWith('05', 'Looks fine now.'));
    await vi.waitFor(() => expect(screen.queryByText(/Request changes · Task 05/)).not.toBeInTheDocument());
  });
});

describe('SpecificationMetadataFields: workflow mode selection at specification creation (D15)', () => {
  function baseProps(overrides: Partial<React.ComponentProps<typeof SpecificationMetadataFields>> = {}) {
    return {
      title: '',
      slug: '',
      type: 'standard' as const,
      goal: '',
      workflowMode: 'legacy' as const,
      slugManuallyEdited: false,
      disabled: false,
      onTitleChange: vi.fn(),
      onSlugChange: vi.fn(),
      onSyncSlugWithTitle: vi.fn(),
      onTypeChange: vi.fn(),
      onGoalChange: vi.fn(),
      onWorkflowModeChange: vi.fn(),
      ...overrides,
    };
  }

  it('defaults to Legacy selected and clicking Deterministic invokes onWorkflowModeChange', () => {
    const onWorkflowModeChange = vi.fn();
    render(<SpecificationMetadataFields {...baseProps({ onWorkflowModeChange })} />);

    expect(screen.getByRole('radio', { name: /Legacy/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Deterministic/i })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('radio', { name: /Deterministic/i }));
    expect(onWorkflowModeChange).toHaveBeenCalledWith('deterministic');
  });

  it('shows the Standard workflow description only when Deterministic is selected for a standard-type spec', () => {
    const { rerender } = render(<SpecificationMetadataFields {...baseProps({ workflowMode: 'legacy' })} />);
    expect(screen.queryByText(/implementation → review → human verification/)).not.toBeInTheDocument();

    rerender(<SpecificationMetadataFields {...baseProps({ workflowMode: 'deterministic', type: 'standard' })} />);
    expect(screen.getByText('Standard workflow')).toBeInTheDocument();
    expect(screen.getByText(/implementation → review → human verification/)).toBeInTheDocument();
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
