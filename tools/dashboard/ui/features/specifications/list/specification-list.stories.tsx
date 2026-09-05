import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

import { SpecificationList } from './specification-list';
import type { SpecificationSummary, SpecificationTask, StageId } from '../types';
import {
  resolveLiveTokenComputed,
  resolveLiveTokenRgba,
  contrastRatio,
  hoverWithNoTransition,
  unhoverWithNoTransition,
} from '@storybook-test-utils';

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

const specForList = createMockSpecification();

const rootRoute = createRootRoute({
  component: () => (
    <div className="w-full max-w-5xl rounded-2xl bg-background p-6" data-testid="spec-list-container">
      <SpecificationList mode="active" specifications={[specForList]} />
    </div>
  ),
});

const specRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/specs/$source/$slug',
  component: () => <div>Spec Detail</div>,
});

const testRouter = createRouter({
  routeTree: rootRoute.addChildren([specRoute]),
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

function SpecificationListStoryWrapper() {
  return <RouterProvider router={testRouter} />;
}

const meta: Meta<typeof SpecificationList> = {
  title: 'Features/Specifications/List/SpecificationList',
  component: SpecificationList,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const SpecificationListHover: Story = {
  render: () => <SpecificationListStoryWrapper />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const specTitle = canvas.getByText('Migracja tokenów semantycznych');
    expect(specTitle).toBeInTheDocument();

    const linkCard = specTitle.closest('a');
    expect(linkCard).not.toBeNull();

    const cardContainer = linkCard!.querySelector('.rounded-2xl');
    expect(cardContainer).not.toBeNull();

    const arrowIcon = linkCard!.querySelector('svg.lucide-arrow-right');
    expect(arrowIcon).not.toBeNull();
    expect(arrowIcon).toHaveClass('text-accent');

    const expectedAccent = resolveLiveTokenComputed('--color-accent');
    const initialIconColor = window.getComputedStyle(arrowIcon!).color;
    expect(initialIconColor).toBe(expectedAccent);

    // Trigger hover on card
    await hoverWithNoTransition(cardContainer as HTMLElement);

    const hoveredIconColor = window.getComputedStyle(arrowIcon!).color;
    expect(hoveredIconColor).toBe(expectedAccent);

    // Verify hover contrast >= 4.5:1 against surface-raised
    const fgRgb = resolveLiveTokenRgba('--color-accent');
    const bgRgb = resolveLiveTokenRgba('--color-surface-raised');
    const contrast = contrastRatio([fgRgb[0], fgRgb[1], fgRgb[2]], [bgRgb[0], bgRgb[1], bgRgb[2]]);
    expect(contrast).toBeGreaterThanOrEqual(4.5);

    await unhoverWithNoTransition(cardContainer as HTMLElement);
  },
};
