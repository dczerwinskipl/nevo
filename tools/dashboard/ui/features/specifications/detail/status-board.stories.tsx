import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { StatusBoard } from './status-board';
import type { SpecificationSummary, SpecificationTask, StageId } from '../types';
import { resolveLiveTokenComputed } from '@storybook-test-utils';

function createMockTask(overrides: Partial<SpecificationTask>): SpecificationTask {
  return {
    id: 'task-1',
    title: 'Przykładowe zadanie',
    status: 'pending',
    stage: 'new',
    order: 1,
    dependsOn: [],
    blockedBy: [],
    ready: true,
    terminal: false,
    file: 'tasks/01-task.md',
    ...overrides,
  };
}

function createMockSpecification(): SpecificationSummary {
  const lanes: Array<{ id: StageId; label: string; shortLabel: string; tasks: SpecificationTask[] }> = [
    {
      id: 'new',
      label: 'Nowe zadania',
      shortLabel: 'Nowe',
      tasks: [createMockTask({ id: 'task-new', stage: 'new', order: 1, title: 'Inicjalizacja' })],
    },
    {
      id: 'design',
      label: 'Projektowanie',
      shortLabel: 'Projekt',
      tasks: [createMockTask({ id: 'task-design', stage: 'design', order: 2, title: 'Architektura' })],
    },
    {
      id: 'ready',
      label: 'Gotowe do imp.',
      shortLabel: 'Ready',
      tasks: [createMockTask({ id: 'task-ready', stage: 'ready', order: 3, title: 'Specyfikacja zaakceptowana' })],
    },
    {
      id: 'implementation',
      label: 'Wdrożenie',
      shortLabel: 'Imp.',
      tasks: [createMockTask({ id: 'task-impl', stage: 'implementation', order: 4, title: 'Kodowanie modułu' })],
    },
    {
      id: 'review',
      label: 'Weryfikacja',
      shortLabel: 'Review',
      tasks: [createMockTask({ id: 'task-review', stage: 'review', order: 5, title: 'Przegląd zmian' })],
    },
    {
      id: 'done',
      label: 'Ukończone',
      shortLabel: 'Done',
      tasks: [createMockTask({ id: 'task-done', stage: 'done', order: 6, title: 'Wdrożone na produkcję' })],
    },
  ];

  return {
    id: 'spec-test',
    specId: 'SPEC-001',
    slug: 'semantic-tokens-test',
    title: 'Migracja tokenów semantycznych',
    status: 'in-implementation',
    source: 'active',
    priority: 1,
    created: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-05T10:00:00Z',
    path: 'specs/active/semantic-tokens-test',
    overviewFile: 'overview.md',
    summary: 'Kompleksowa migracja dashboardu na semantyczne tokeny Tailwind CSS v4.',
    tasks: lanes.flatMap((l) => l.tasks),
    lanes,
    nextTask: lanes[3].tasks[0],
    metrics: {
      total: 6,
      actionable: 5,
      completed: 1,
      abandoned: 0,
      inImplementation: 1,
      inReview: 1,
      ready: 1,
      stageCounts: {
        new: 1,
        design: 1,
        ready: 1,
        implementation: 1,
        review: 1,
        done: 1,
      },
      progress: 17,
    },
  };
}

function StatusBoardStoryWrapper() {
  const spec = createMockSpecification();
  return (
    <div className="w-full max-w-7xl rounded-2xl bg-surface p-6 text-fg-primary" data-testid="status-board-container">
      <StatusBoard specification={spec} />
    </div>
  );
}

const meta: Meta<typeof StatusBoard> = {
  title: 'Features/Specifications/Detail/StatusBoard',
  component: StatusBoard,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const StatusBoardLanes: Story = {
  render: () => <StatusBoardStoryWrapper />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const laneConfigs: Array<{
      id: StageId;
      shortLabel: string;
      expectedClass: string;
      expectedToken: string;
    }> = [
      { id: 'new', shortLabel: 'Nowe', expectedClass: 'bg-status-neutral', expectedToken: '--color-status-neutral' },
      {
        id: 'design',
        shortLabel: 'Projekt',
        expectedClass: 'bg-workflow-design',
        expectedToken: '--color-workflow-design',
      },
      { id: 'ready', shortLabel: 'Ready', expectedClass: 'bg-status-info', expectedToken: '--color-status-info' },
      {
        id: 'implementation',
        shortLabel: 'Imp.',
        expectedClass: 'bg-status-active',
        expectedToken: '--color-status-active',
      },
      {
        id: 'review',
        shortLabel: 'Review',
        expectedClass: 'bg-status-warning',
        expectedToken: '--color-status-warning',
      },
      { id: 'done', shortLabel: 'Done', expectedClass: 'bg-status-success', expectedToken: '--color-status-success' },
    ];

    for (const lane of laneConfigs) {
      const labelEl = canvas.getByText(lane.shortLabel);
      expect(labelEl).toBeInTheDocument();

      const laneHeaderContainer = labelEl.parentElement;
      expect(laneHeaderContainer).not.toBeNull();

      const dot = laneHeaderContainer!.querySelector('span.rounded-full');
      expect(dot).not.toBeNull();
      expect(dot).toHaveClass(lane.expectedClass);

      const computedBg = window.getComputedStyle(dot!).backgroundColor;
      const expectedComputed = resolveLiveTokenComputed(lane.expectedToken);
      expect(computedBg).toBe(expectedComputed);
    }
  },
};
