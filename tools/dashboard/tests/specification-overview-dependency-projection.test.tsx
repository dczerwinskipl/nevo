// Regression for SequentialQueueTaskPicker's dependency-satisfaction projection.
// Root cause (fixed alongside this test): the picker had two independent,
// inconsistent local heuristics for "is this dependency satisfied" — one feeding
// `readyTaskIds` (`t.status === 'approved'`, never checking dependencies at all)
// and a separate one feeding `dependencyWarnings`
// (`depTask?.status === 'verified' || depGate?.state === 'terminal' || depGate?.terminalOutcome === 'success'`)
// — neither of which read the canonical, server-computed `blockedBy`/`ready`
// fields already present on every `SpecificationTask`. A dependency could be
// satisfied per the canonical projection (absent from the dependant's own
// `blockedBy`) while its own status/gate still disagreed with the second
// heuristic, producing a task shown as READY alongside a warning that it
// depends on an "unsatisfied" task.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SequentialQueueTaskPicker } from '../ui/screens/specification-detail/specification-overview';
import type { SpecificationTask, SpecificationTaskActionGate } from '../ui/features/specifications/types';

function makeTask(overrides: Partial<SpecificationTask>): SpecificationTask {
  return {
    id: 'task',
    title: 'Task',
    status: 'draft',
    stage: 'new',
    order: 1,
    dependsOn: [],
    blockedBy: [],
    ready: false,
    terminal: false,
    file: null,
    ...overrides,
  };
}

describe('SequentialQueueTaskPicker: canonical dependency projection', () => {
  it('shows no warning for a dependency the canonical projection already treats as satisfied, even when the old status/gate heuristic would have disagreed', () => {
    // actor-resolver: canonical TaskProjection/ExecutionReadiness already dropped it
    // from the dependant's own blockedBy, but its own status is still 'implemented'
    // (not 'verified') and its gate is still 'active' (not 'terminal') — exactly the
    // shape that tripped the old, second heuristic.
    const dependency = makeTask({
      id: 'actor-resolver',
      title: 'Actor resolver',
      order: 3,
      status: 'implemented',
      ready: false,
      terminal: false,
    });
    const dependant = makeTask({
      id: 'workflow-step-activity-producer',
      title: 'Workflow step activity producer',
      order: 6,
      dependsOn: ['actor-resolver'],
      blockedBy: [], // canonical: nothing is blocking this task
      ready: true,
    });

    const taskActions: Record<string, SpecificationTaskActionGate> = {
      'actor-resolver': { action: 'verify', enabled: false, reason: null, state: 'active', terminalOutcome: null },
      'workflow-step-activity-producer': { action: 'verify', enabled: false, reason: null, state: 'ready', availableActions: ['start-step'] },
    };

    render(
      <SequentialQueueTaskPicker
        tasks={[dependency, dependant]}
        taskActions={taskActions}
      />,
    );

    // Both pre-selected as ready (readyTaskIds derives from canonical `t.ready`/gate signals).
    expect(screen.getByLabelText(`Wybierz zadanie ${dependant.title}`)).toBeChecked();

    // No dependency warning: the canonical projection (blockedBy) says this is satisfied.
    expect(screen.queryByRole('alert', { name: /Ostrzeżenia o zależnościach/i })).not.toBeInTheDocument();
  });

  it('still warns when the canonical projection says the dependency really is blocking', () => {
    const dependency = makeTask({
      id: 'actor-resolver',
      title: 'Actor resolver',
      order: 3,
      status: 'draft',
      ready: false,
      terminal: false,
    });
    const dependant = makeTask({
      id: 'workflow-step-activity-producer',
      title: 'Workflow step activity producer',
      order: 6,
      dependsOn: ['actor-resolver'],
      blockedBy: ['actor-resolver'], // canonical: genuinely still blocked
      ready: false,
    });

    render(
      <SequentialQueueTaskPicker
        tasks={[dependency, dependant]}
        taskActions={{}}
      />,
    );

    // Dependency warnings are cross-SELECTION: select the dependant (not pre-selected,
    // since it is not canonically ready) to exercise the warning path.
    fireEvent.click(screen.getByLabelText(`Wybierz zadanie ${dependant.title}`));

    expect(screen.getByRole('alert', { name: /Ostrzeżenia o zależnościach/i })).toBeInTheDocument();
    expect(screen.getByText(dependant.title)).toBeInTheDocument();
    expect(screen.getByText('actor-resolver')).toBeInTheDocument();
  });

  it('readyTaskIds and dependencyWarnings agree on the same canonical satisfaction signal for a task with multiple dependencies', () => {
    const depA = makeTask({ id: 'dep-a', title: 'Dep A', order: 1, status: 'verified', ready: false, terminal: true });
    const depB = makeTask({ id: 'dep-b', title: 'Dep B', order: 2, status: 'in-implementation', ready: false, terminal: false });
    const dependant = makeTask({
      id: 'dependant',
      title: 'Dependant',
      order: 3,
      dependsOn: ['dep-a', 'dep-b'],
      blockedBy: ['dep-b'], // canonical: dep-a satisfied, dep-b still blocking
      ready: false,
    });

    render(
      <SequentialQueueTaskPicker
        tasks={[depA, depB, dependant]}
        taskActions={{}}
      />,
    );

    fireEvent.click(screen.getByLabelText(`Wybierz zadanie ${dependant.title}`));

    const warningRegion = screen.getByRole('alert', { name: /Ostrzeżenia o zależnościach/i });
    expect(warningRegion).toHaveTextContent('dep-b');
    expect(warningRegion).not.toHaveTextContent('dep-a');
  });
});
