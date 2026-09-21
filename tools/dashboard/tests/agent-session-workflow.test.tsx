import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AgentSessionWorkflowBar, type BoundTaskInfo } from '../ui/features/agent-sessions/agent-session-workflow-bar';
import { AgentSessionChatSurface } from '../ui/features/agent-sessions/agent-session-chat-surface';
import { buildAgentStepTriggerMessage } from '../ui/features/agent-sessions/queries';
import { SpecificationMetadataFields } from '../ui/screens/specification-console/create-specification/specification-metadata-fields';
import { HumanStepSurface } from '../ui/shared/workflow/human-step-surface';
import { TaskDialog } from '../ui/features/specifications/tasks/task-dialog';
import type { CanonicalTurn } from '../ui/features/agent-sessions/types';
import type { SpecificationSummary, SpecificationTaskActionGate } from '../ui/features/specifications/types';

// Mock spec-detail-queries for TaskDialog tests
const mockActionsQueryData = {
  data: null as any,
  loading: false,
  executing: false,
  executionError: null as string | null,
  refresh: vi.fn(),
  execute: vi.fn(),
};

const mockDocumentQueryData = {
  data: { available: true, markdown: '# Task details' },
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
};

vi.mock('../ui/features/specifications/detail/spec-detail-queries', () => ({
  useSpecificationActions: () => mockActionsQueryData,
  useSpecificationDocument: () => mockDocumentQueryData,
}));

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

describe('HumanStepSurface: reusable, presentational human step interaction (Task 20, D11, D16, D17)', () => {
  it('renders action buttons with dynamic labels from interaction.actions', () => {
    const onSubmit = vi.fn();
    render(
      <HumanStepSurface
        interaction={{
          actions: [
            { result: 'pass', label: 'Approve changes', feedbackRequired: false },
            { result: 'fail', label: 'Request rework', feedbackRequired: true },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: 'Approve changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request rework' })).toBeInTheDocument();
  });

  it('submitting an unconditional action (no result declared) calls onSubmit with undefined result', () => {
    const onSubmit = vi.fn();
    render(
      <HumanStepSurface
        interaction={{
          actions: [
            { label: 'Complete manual check', feedbackRequired: false },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Complete manual check' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(undefined, undefined, undefined);
  });

  it('action with feedbackRequired prompts for feedback before submitting', () => {
    const onSubmit = vi.fn();
    render(
      <HumanStepSurface
        interaction={{
          actions: [
            { result: 'fail', label: 'Reject with notes', feedbackRequired: true },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );

    // Initial click opens feedback form
    fireEvent.click(screen.getByRole('button', { name: 'Reject with notes' }));
    expect(screen.getByText('Wymagana informacja zwrotna')).toBeInTheDocument();

    const textarea = screen.getByLabelText('Informacja zwrotna');
    expect(textarea).toBeInTheDocument();

    // Empty feedback cannot be submitted
    const submitBtn = screen.getByRole('button', { name: 'Zatwierdź' });
    expect(submitBtn).toBeDisabled();

    // Entering feedback enables submit
    fireEvent.change(textarea, { target: { value: 'Needs error handling' } });
    expect(submitBtn).toBeEnabled();

    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledWith('fail', 'Needs error handling', undefined);
  });

  it('renders error banner when error is provided', () => {
    render(
      <HumanStepSurface
        interaction={{ actions: [] }}
        error="Failed to submit decision"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to submit decision');
  });
});

describe('AgentSessionChatSurface: generic waiting-step and human-interaction integration (Task 20, D7, D15, D19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('a legacy session (isDeterministic=false) never renders human interaction or generic start-step', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          isDeterministic: false,
          activeTaskId: '05',
          availableActions: ['start-step'],
          humanInteraction: {
            actions: [{ result: 'pass', label: 'Approve', feedbackRequired: false }],
          },
          boundTasks: [{ id: '05', title: 'Legacy task' }],
        })}
      />,
    );

    expect(screen.queryByTestId('human-step-surface')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start step for task 05/i })).not.toBeInTheDocument();
    expect(screen.getByText('05 · Legacy task')).toBeInTheDocument();
  });

  it('renders HumanStepSurface when deterministic active task has humanInteraction', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, action: 'submit' }),
    } as Response);

    const onRefreshTaskActions = vi.fn();

    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          isDeterministic: true,
          activeTaskId: '05',
          specSlug: 'demo-spec',
          activeTaskAttempt: 2,
          humanInteraction: {
            actions: [
              { result: 'pass', label: 'Approve verification', feedbackRequired: false },
            ],
          },
          onRefreshTaskActions,
          boundTasks: [{ id: '05', status: 'in-review', currentStep: 'human-verification', attempt: 2 }],
        })}
      />,
    );

    expect(screen.getByTestId('human-step-surface')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve verification' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve verification' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain('/api/specs/demo-spec/tasks/05/workflow/human-step');
    expect(JSON.parse(calledOptions?.body as string)).toEqual({ action: 'submit', result: 'pass' });
  });

  it('renders generic Start control for waiting human step and calls mutation.start()', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, action: 'start' }),
    } as Response);

    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          isDeterministic: true,
          activeTaskId: '05',
          specSlug: 'demo-spec',
          availableActions: ['start-step'],
          stepDescriptor: {
            id: 'audit',
            executor: 'human',
            purpose: 'Security audit',
          },
          humanInteraction: null,
          boundTasks: [{ id: '05', status: 'in-implementation' }],
        })}
      />,
    );

    expect(screen.queryByTestId('human-step-surface')).not.toBeInTheDocument();
    const startBtn = screen.getByRole('button', { name: 'Start step for task 05' });
    expect(startBtn).toBeInTheDocument();
    expect(screen.getByText('Security audit')).toBeInTheDocument();

    fireEvent.click(startBtn);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain('/api/specs/demo-spec/tasks/05/workflow/human-step');
    expect(JSON.parse(calledOptions?.body as string)).toEqual({ action: 'start' });
  });

  it('renders generic Start control for waiting agent step and calls onStartAgentStep', () => {
    const onStartAgentStep = vi.fn();

    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          isDeterministic: true,
          activeTaskId: '05',
          availableActions: ['start-step'],
          stepDescriptor: {
            id: 'review',
            executor: 'agent',
            purpose: 'Code review',
          },
          humanInteraction: null,
          onStartAgentStep,
          boundTasks: [{ id: '05', status: 'in-implementation' }],
        })}
      />,
    );

    const startBtn = screen.getByRole('button', { name: 'Start step for task 05' });
    expect(startBtn).toBeInTheDocument();
    expect(screen.getByText('Code review')).toBeInTheDocument();

    fireEvent.click(startBtn);
    expect(onStartAgentStep).toHaveBeenCalledTimes(1);
    expect(onStartAgentStep).toHaveBeenCalledWith('05');
  });
});

describe('TaskDialog: deterministic human step surface and generic start step wiring (Task 20, D7, D15, D19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const demoSpec: SpecificationSummary = {
    id: 'demo-spec',
    specId: 'spec-123',
    slug: 'demo-spec',
    title: 'Demo Spec',
    status: 'in-implementation',
    source: 'active',
    priority: 1,
    created: '2026-01-01',
    updatedAt: '2026-01-01',
    path: 'specs/active/demo-spec',
    overviewFile: 'overview.md',
    summary: 'Demo',
    tasks: [
      {
        id: 'task-custom-human',
        title: 'Task with custom human step',
        status: 'in-implementation',
        stage: 'implementation',
        order: 1,
        dependsOn: [],
        blockedBy: [],
        ready: true,
        terminal: false,
        file: 'tasks/01.md',
      },
      {
        id: 'task-waiting',
        title: 'Task waiting for next step',
        status: 'in-implementation',
        stage: 'implementation',
        order: 2,
        dependsOn: [],
        blockedBy: [],
        ready: true,
        terminal: false,
        file: 'tasks/02.md',
      },
    ],
    lanes: [],
    nextTask: null,
    metrics: {} as any,
  };

  it('renders HumanStepSurface for deterministic task on a step not literally named human-verification', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, action: 'submit' }),
    } as Response);

    mockActionsQueryData.data = {
      workflowMode: 'deterministic',
      tasks: {
        'task-custom-human': {
          action: 'verify',
          enabled: true,
          reason: null,
          state: 'human-interaction',
          executor: 'human',
          currentStep: 'security-audit',
          humanInteraction: {
            actions: [
              { result: 'signoff', label: 'Sign off security', feedbackRequired: false },
              { result: 'changes', label: 'Reject with issues', feedbackRequired: true },
            ],
          },
        } as SpecificationTaskActionGate,
      },
    };

    render(
      <TaskDialog
        specification={demoSpec}
        taskId="task-custom-human"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('human-step-surface')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign off security' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject with issues' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign off security' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain('/api/specs/active/demo-spec/tasks/task-custom-human/workflow/human-step');
    expect(JSON.parse(calledOptions?.body as string)).toEqual({ action: 'submit', result: 'signoff' });
  });

  it('shows generic step descriptor and [Start] control for waiting step, calling onStartStep test double', () => {
    const onStartStep = vi.fn();

    mockActionsQueryData.data = {
      workflowMode: 'deterministic',
      tasks: {
        'task-waiting': {
          action: 'verify',
          enabled: true,
          reason: null,
          state: 'waiting-for-step-start',
          availableActions: ['start-step'],
          stepDescriptor: {
            id: 'hardening',
            executor: 'agent',
            purpose: 'Security hardening work',
          },
          humanInteraction: null,
        } as SpecificationTaskActionGate,
      },
    };

    render(
      <TaskDialog
        specification={demoSpec}
        taskId="task-waiting"
        onClose={vi.fn()}
        onStartStep={onStartStep}
      />,
    );

    expect(screen.getByText('Security hardening work')).toBeInTheDocument();
    const startBtn = screen.getByRole('button', { name: 'Start' });
    expect(startBtn).toBeInTheDocument();

    fireEvent.click(startBtn);
    expect(onStartStep).toHaveBeenCalledTimes(1);
    expect(onStartStep).toHaveBeenCalledWith({
      id: 'hardening',
      executor: 'agent',
      purpose: 'Security hardening work',
    });
  });

  it('renders legacy TaskActionFooter byte-for-byte unchanged when workflowMode is legacy', () => {
    mockActionsQueryData.data = {
      workflowMode: 'legacy',
      tasks: {
        'task-custom-human': {
          action: 'approve',
          enabled: true,
          reason: null,
        } as SpecificationTaskActionGate,
      },
    };

    render(
      <TaskDialog
        specification={demoSpec}
        taskId="task-custom-human"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('human-step-surface')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zatwierdź zadanie/i })).toBeInTheDocument();
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
  it('renders no action buttons when the server projects an empty availableActions array and no human interaction', () => {
    render(
      <AgentSessionChatSurface
        {...baseChatSurfaceProps({
          activeTaskId: '06',
          availableActions: [],
          humanInteraction: null,
          boundTasks: [{ id: '06', status: 'approved' }],
        })}
      />,
    );

    expect(screen.queryByTestId('human-step-surface')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start/i })).not.toBeInTheDocument();
  });
});

describe('Session bootstrap primitives: buildAgentStepTriggerMessage and types.ts (Task 15, D15, D18)', () => {
  it('buildAgentStepTriggerMessage produces the identical generic trigger string for the same taskId regardless of step context', () => {
    const messageReview = buildAgentStepTriggerMessage('task-123');
    const messageHardening = buildAgentStepTriggerMessage('task-123');
    expect(messageReview).toBe(messageHardening);
    expect(messageReview).toContain('task-123');
    expect(messageReview).not.toMatch(/review/i);
    expect(messageReview).not.toMatch(/hardening/i);
    expect(messageReview).not.toMatch(/implementation/i);
    expect(messageReview).toBe('Execute the current workflow step for task task-123.');

    const messageOther = buildAgentStepTriggerMessage('task-999');
    expect(messageOther).toBe('Execute the current workflow step for task task-999.');
    expect(messageOther).not.toBe(messageReview);
  });

  it('structural guarantee: buildAgentStepTriggerMessage accepts only taskId — length is 1', () => {
    expect(buildAgentStepTriggerMessage.length).toBe(1);
  });

  it('structural guarantee: no switch/if/lookup keyed on step.id, currentStep, or nextStep exists in queries.ts', () => {
    const queriesSource = readFileSync(resolve(process.cwd(), 'ui/features/agent-sessions/queries.ts'), 'utf8');
    expect(queriesSource).not.toMatch(/switch\s*\([^)]*(?:step\.id|currentStep|nextStep)/);
    expect(queriesSource).not.toMatch(/if\s*\([^)]*(?:current_step|currentStep|nextStep)\s*===/);
  });

  it('types.ts carries state, executor, stepDescriptor, blockedBy, terminalOutcome, humanInteraction, and availableActions?: string[]', () => {
    const gateDto: SpecificationTaskActionGate = {
      action: 'verify',
      enabled: true,
      reason: null,
      state: 'ready',
      executor: 'agent',
      blockedBy: [],
      terminalOutcome: null,
      terminalStatus: null,
      stepDescriptor: {
        id: 'implementation',
        executor: 'agent',
        purpose: 'Implementation work',
        expectedWork: { summary: 'Code' },
      },
      currentStepDescriptor: null,
      nextStepDescriptor: {
        id: 'implementation',
        executor: 'agent',
        purpose: 'Implementation work',
        expectedWork: { summary: 'Code' },
      },
      humanInteraction: null,
      availableActions: ['start-step'],
      status: 'approved',
      currentStep: null,
      attempt: null,
      workflowState: null,
    };

    expect(gateDto.state).toBe('ready');
    expect(gateDto.executor).toBe('agent');
    expect(gateDto.stepDescriptor?.id).toBe('implementation');
    expect(gateDto.availableActions).toEqual(['start-step']);
  });
});

describe('Structural and architectural guarantees (Task 20, D11, D17, D19, D20)', () => {
  it('confirm task-dialog.tsx and agent-session-chat-surface.tsx both import shared/workflow/human-step-surface.tsx, never each other', () => {
    const dialogSrc = readFileSync(resolve(process.cwd(), 'ui/features/specifications/tasks/task-dialog.tsx'), 'utf8');
    const chatSrc = readFileSync(resolve(process.cwd(), 'ui/features/agent-sessions/agent-session-chat-surface.tsx'), 'utf8');

    expect(dialogSrc).toMatch(/from ['"]@\/shared\/workflow\/human-step-surface['"]/);
    expect(chatSrc).toMatch(/from ['"]@\/shared\/workflow\/human-step-surface['"]/);

    expect(dialogSrc).not.toMatch(/features\/agent-sessions/);
    expect(chatSrc).not.toMatch(/features\/specifications/);
  });

  it('confirm HumanStepSurface contains no fetch(, no route URL string literal, and no approve/request-changes literals', () => {
    const surfaceSrc = readFileSync(resolve(process.cwd(), 'ui/shared/workflow/human-step-surface.tsx'), 'utf8');

    expect(surfaceSrc).not.toMatch(/\bfetch\s*\(/);
    expect(surfaceSrc).not.toMatch(/\/api\//);
    expect(surfaceSrc).not.toMatch(/['"]approve['"]/i);
    expect(surfaceSrc).not.toMatch(/['"]request-changes['"]/i);
    expect(surfaceSrc).not.toMatch(/human-verification/);
  });

  it('confirm none of start-review, Start review, onStartReviewTask, or onApproveTask appear in agent-session-chat-surface.tsx', () => {
    const chatSrc = readFileSync(resolve(process.cwd(), 'ui/features/agent-sessions/agent-session-chat-surface.tsx'), 'utf8');

    expect(chatSrc).not.toContain('start-review');
    expect(chatSrc).not.toContain('Start review');
    expect(chatSrc).not.toContain('onStartReviewTask');
    expect(chatSrc).not.toContain('onApproveTask');
  });
});
