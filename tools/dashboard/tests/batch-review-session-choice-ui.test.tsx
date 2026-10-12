import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
  BatchReviewChoiceSelector,
  BatchReviewSessionChoiceDialog,
} from '../ui/features/specifications/tasks/session-choice';
import { SequentialQueueTaskPicker } from '../ui/screens/specification-detail/specification-overview';
import type { SpecificationTask, SpecificationTaskActionGate } from '../ui/features/specifications/types';

describe('Batch Review Session Choice UI (Task 06)', () => {
  // AC 1: Two selected tasks where one is not at review: control is visible, disabled, and names blocking task
  it('shows batch-review control disabled and names blocking task when one task is not at review', () => {
    const tasks: SpecificationTask[] = [
      { id: 'task-1', title: 'Task One', status: 'in-review', stage: 'review', order: 1, dependsOn: [], blockedBy: [], ready: true, terminal: false, file: null },
      { id: 'task-2', title: 'Task Two', status: 'in-implementation', stage: 'implementation', order: 2, dependsOn: [], blockedBy: [], ready: true, terminal: false, file: null },
    ];
    const taskActions: Record<string, SpecificationTaskActionGate> = {
      'task-1': {
        action: 'verify', enabled: true, reason: null, state: 'ready', availableActions: ['start-step'],
        execution: { role: 'reviewer' }, stepDescriptor: { id: 'review', executor: 'agent' },
      },
      'task-2': {
        action: 'verify', enabled: true, reason: null, state: 'ready', availableActions: ['start-step'],
        execution: { role: 'implementer' }, stepDescriptor: { id: 'implementation', executor: 'agent' },
      },
    };

    render(
      <SequentialQueueTaskPicker
        tasks={tasks}
        taskActions={taskActions}
      />,
    );

    const button = screen.getByRole('button', { name: /Review together/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/Task Two|task-2/);
    expect(screen.getByText(/nie jest w kroku review/i)).toBeInTheDocument();
    expect(screen.getByText(/task-2/i)).toBeInTheDocument();
  });

  // AC 2: Three eligible tasks: owner can choose new batch session or continue each; matching requests sent
  it('with three eligible tasks, lets owner choose new batch session or continue each and calls matching handler', async () => {
    const onConfirm = vi.fn();
    const tasks = [
      { id: 'task-1', title: 'Task 1' },
      { id: 'task-2', title: 'Task 2' },
      { id: 'task-3', title: 'Task 3' },
    ];
    const taskActions: Record<string, SpecificationTaskActionGate> = {
      'task-1': {
        action: 'verify', enabled: true, reason: null,
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's1', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 1' } },
      },
      'task-2': {
        action: 'verify', enabled: true, reason: null,
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's2', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 2' } },
      },
      'task-3': {
        action: 'verify', enabled: true, reason: null,
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's3', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 3' } },
      },
    };

    // Test new batch session
    const { unmount } = render(
      <BatchReviewSessionChoiceDialog
        open={true}
        specificationTitle="Test Spec"
        tasks={tasks}
        taskActions={taskActions}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const newBatchBtn = screen.getByRole('button', { name: /One new batch session/i });
    const continueEachBtn = screen.getByRole('button', { name: /Continue each task in its own session/i });
    expect(newBatchBtn).toHaveAttribute('aria-pressed', 'true');
    expect(continueEachBtn).toHaveAttribute('aria-pressed', 'false');

    const startBtn = screen.getByRole('button', { name: /^Start$/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'new-batch',
        reviewTogether: true,
        batchContinuation: false,
      }));
    });

    unmount();

    // Test continue each task
    const onConfirm2 = vi.fn();
    render(
      <BatchReviewSessionChoiceDialog
        open={true}
        specificationTitle="Test Spec"
        tasks={tasks}
        taskActions={taskActions}
        onClose={vi.fn()}
        onConfirm={onConfirm2}
      />,
    );

    const continueBtn = screen.getByRole('button', { name: /Continue each task in its own session/i });
    fireEvent.click(continueBtn);
    expect(continueBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /^Start$/i }));

    await waitFor(() => {
      expect(onConfirm2).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'continue-each',
        reviewTogether: false,
        batchContinuation: true,
      }));
    });
  });

  // AC 3: Continue-each is disabled with a reason when a task has no candidate
  it('disables continue-each with a reason when a task has no candidate', () => {
    const tasks = [
      { id: 'task-1', title: 'Task 1' },
      { id: 'task-2', title: 'Task 2' },
    ];
    const taskActions: Record<string, SpecificationTaskActionGate> = {
      'task-1': {
        action: 'verify', enabled: true, reason: null,
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's1', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 1' } },
      },
      'task-2': {
        action: 'verify', enabled: true, reason: null,
        sessionChoice: { default: 'fresh', allowed: ['fresh'], candidate: null },
      },
    };

    render(
      <BatchReviewSessionChoiceDialog
        open={true}
        specificationTitle="Test Spec"
        tasks={tasks}
        taskActions={taskActions}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const continueEachBtn = screen.getByRole('button', { name: /Continue each task in its own session/i });
    expect(continueEachBtn).toBeDisabled();
    expect(screen.getByText(/Niedostępne/i)).toBeInTheDocument();
    expect(screen.getByText(/nie posiada sesji kandydata/i)).toBeInTheDocument();
    expect(screen.getByText(/Task 2/i)).toBeInTheDocument();
  });

  // AC 4: The sequential-execution note is shown for continue-each
  it('shows the sequential-execution note for continue-each', () => {
    const tasks = [
      { id: 'task-1', title: 'Task 1' },
      { id: 'task-2', title: 'Task 2' },
    ];
    render(
      <BatchReviewChoiceSelector
        tasks={tasks}
        value="new-batch"
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Zadania wykonywane są sekwencyjnie, jedno po drugim, w kolejności wyboru/i),
    ).toBeInTheDocument();
  });

  // AC: Independence warning is shown for continue-each
  it('shows the review independence warning when continue-each is selected', () => {
    const tasks = [
      { id: 'task-1', title: 'Task 1' },
      { id: 'task-2', title: 'Task 2' },
    ];
    const taskActions: Record<string, SpecificationTaskActionGate> = {
      'task-1': {
        action: 'verify', enabled: true, reason: null,
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's1', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 1' } },
      },
      'task-2': {
        action: 'verify', enabled: true, reason: null,
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's2', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 2' } },
      },
    };

    render(
      <BatchReviewChoiceSelector
        tasks={tasks}
        taskActions={taskActions}
        value="continue-each"
        onChange={vi.fn()}
      />,
    );

    const warning = screen.getByRole('alert');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent(/zmniejsza niezależność przeglądu/i);
  });

  // AC: Errors from the start call are displayed in the flow, not swallowed
  it('displays errors from start call in the flow and does not swallow them', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Turn start failed: admission rejected'));
    const tasks = [
      { id: 'task-1', title: 'Task 1' },
      { id: 'task-2', title: 'Task 2' },
    ];

    render(
      <BatchReviewSessionChoiceDialog
        open={true}
        specificationTitle="Test Spec"
        tasks={tasks}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Start$/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('Turn start failed: admission rejected');
    });
  });

  // AC: Integration with SequentialQueueTaskPicker
  it('SequentialQueueTaskPicker opens dialog on Review together click and calls onStartStep with chosen mode', async () => {
    const onStartStep = vi.fn().mockResolvedValue(undefined);
    const tasks: SpecificationTask[] = [
      { id: 't1', title: 'Task 1', status: 'in-review', stage: 'review', order: 1, dependsOn: [], blockedBy: [], ready: true, terminal: false, file: null },
      { id: 't2', title: 'Task 2', status: 'in-review', stage: 'review', order: 2, dependsOn: [], blockedBy: [], ready: true, terminal: false, file: null },
      { id: 't3', title: 'Task 3', status: 'in-review', stage: 'review', order: 3, dependsOn: [], blockedBy: [], ready: true, terminal: false, file: null },
    ];
    const taskActions: Record<string, SpecificationTaskActionGate> = {
      t1: {
        action: 'verify', enabled: true, reason: null, state: 'ready', availableActions: ['start-step'], execution: { role: 'reviewer' }, stepDescriptor: { id: 'review', executor: 'agent' },
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's1', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 1' } },
      },
      t2: {
        action: 'verify', enabled: true, reason: null, state: 'ready', availableActions: ['start-step'], execution: { role: 'reviewer' }, stepDescriptor: { id: 'review', executor: 'agent' },
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's2', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 2' } },
      },
      t3: {
        action: 'verify', enabled: true, reason: null, state: 'ready', availableActions: ['start-step'], execution: { role: 'reviewer' }, stepDescriptor: { id: 'review', executor: 'agent' },
        sessionChoice: { default: 'reuse', allowed: ['reuse', 'fresh'], candidate: { sessionId: 's3', step: 'impl', attempt: 1, provider: 'claude', label: 'Session 3' } },
      },
    };

    render(
      <SequentialQueueTaskPicker
        specification={{ id: 'spec-1', specId: 's-1', slug: 'spec-1', title: 'Test Spec' } as any}
        tasks={tasks}
        taskActions={taskActions}
        onStartStep={onStartStep}
      />,
    );

    const reviewTogetherBtn = screen.getByRole('button', { name: /Review together/i });
    expect(reviewTogetherBtn).toBeEnabled();
    fireEvent.click(reviewTogetherBtn);

    // Dialog is open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const continueOption = screen.getByRole('button', { name: /Continue each task in its own session/i });
    fireEvent.click(continueOption);

    const startBtn = screen.getByRole('button', { name: /^Start$/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStartStep).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' }),
        expect.objectContaining({ id: 'review' }),
        ['t1', 't2', 't3'],
        expect.objectContaining({ batchContinuation: true }),
      );
    });
  });
});
