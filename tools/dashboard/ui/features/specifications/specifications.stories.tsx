import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

import { StatusBoard } from './detail/status-board';
import { SpecificationList } from './list/specification-list';
import { PullRequestSummaryCard } from '../pull-requests/detail/pull-request-cards';
import { OperationStepRow } from '../operations/operation-progress';
import type { SpecificationSummary, SpecificationTask, StageId } from './types';
import type { AvailablePullRequest } from '../pull-requests/types';
import type { OperationStep } from '../operations/types';
import {
  resolveLiveTokenComputed,
  resolveLiveTokenRgba,
  contrastRatio,
  hoverWithNoTransition,
  unhoverWithNoTransition,
} from '@/components/ui/storybook-test-helpers';

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

const meta: Meta = {
  title: 'Features/Specifications/VisualCoverage',
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj;

// --- Story 1: StatusBoard All 6 Lanes ---

export const StatusBoardLanes: Story = {
  render: () => {
    const spec = createMockSpecification();
    return (
      <div className="w-full max-w-7xl rounded-2xl bg-surface p-6 text-fg-primary" data-testid="status-board-container">
        <StatusBoard specification={spec} />
      </div>
    );
  },
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

// --- Story 2: SpecificationList Item Hover Contrast ---

export const SpecificationListHover: Story = {
  render: () => <RouterProvider router={testRouter} />,
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

// --- Story 3: Pull Request Status Tones ---

function createMockPullRequest(overrides: Partial<AvailablePullRequest>): AvailablePullRequest {
  return {
    availability: 'available',
    state: 'open',
    draft: false,
    number: 42,
    title: 'feat: add semantic color tokens',
    url: 'https://github.com/example/repo/pull/42',
    provider: 'github',
    providerLabel: 'GitHub',
    author: { login: 'developer', url: null, avatarUrl: '' },
    head: { name: 'feature/tokens', label: null, sha: null },
    base: { name: 'main', label: null, sha: null },
    stats: { commits: 3, changedFiles: 8, additions: 142, deletions: 12 },
    reference: { provider: 'github', baseUrl: 'https://github.com', repository: 'repo', number: 42 },
    headSha: 'abc1234',
    mergeableState: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

export const PullRequestStatusTones: Story = {
  render: () => {
    const prOpen = createMockPullRequest({ state: 'open', draft: false, number: 101, title: 'Open PR' });
    const prMerged = createMockPullRequest({ state: 'merged', draft: false, number: 102, title: 'Merged PR' });
    const prClosed = createMockPullRequest({ state: 'closed', draft: false, number: 103, title: 'Closed PR' });
    const prDraft = createMockPullRequest({ state: 'open', draft: true, number: 104, title: 'Draft PR' });

    return (
      <div className="w-full max-w-4xl space-y-4 rounded-2xl bg-surface p-6" data-testid="pr-container">
        <PullRequestSummaryCard pullRequest={prOpen} onOpen={() => {}} />
        <PullRequestSummaryCard pullRequest={prMerged} onOpen={() => {}} />
        <PullRequestSummaryCard pullRequest={prClosed} onOpen={() => {}} />
        <PullRequestSummaryCard pullRequest={prDraft} onOpen={() => {}} />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const openBadge = canvas.getByText('Open');
    expect(openBadge).toHaveClass('border-status-active/25');

    const mergedBadge = canvas.getByText('Merged');
    expect(mergedBadge).toHaveClass('border-status-success/25');

    const closedBadge = canvas.getByText('Closed');
    expect(closedBadge).toHaveClass('border-status-neutral/25');

    const draftBadge = canvas.getByText('Draft');
    expect(draftBadge).toHaveClass('border-status-neutral/25');

    // Additions & deletions classes
    const additionsEl = canvas.getAllByText('+142')[0];
    expect(additionsEl).toHaveClass('text-status-success');

    const deletionsEl = canvas.getAllByText('−12')[0];
    expect(deletionsEl).toHaveClass('text-status-error');
  },
};

// --- Story 4: Operation Progress Steps ---

export const OperationProgressSteps: Story = {
  render: () => {
    const steps: OperationStep[] = [
      { id: 's1', label: 'Inicjalizacja środowiska', status: 'completed' },
      { id: 's2', label: 'Wykonywanie migracji bazy danych', status: 'running', current: 3, total: 5 },
      { id: 's3', label: 'Weryfikacja spójności', status: 'failed', error: { message: 'Błąd walidacji schematu' } },
      { id: 's4', label: 'Czyszczenie tymczasowych plików', status: 'pending' },
    ];

    return (
      <ul className="w-full max-w-xl space-y-2 rounded-2xl bg-surface p-6" data-testid="operations-container">
        {steps.map((step) => (
          <OperationStepRow key={step.id} step={step} />
        ))}
      </ul>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const completedLabel = canvas.getByText('Inicjalizacja środowiska');
    expect(completedLabel).toHaveClass('text-fg-secondary');
    const completedRow = completedLabel.closest('li');
    expect(completedRow).toHaveClass('border-border');

    const runningLabel = canvas.getByText('Wykonywanie migracji bazy danych');
    expect(runningLabel).toHaveClass('text-accent');
    const runningRow = runningLabel.closest('li');
    expect(runningRow).toHaveClass('border-accent/35');

    const failedLabel = canvas.getByText('Weryfikacja spójności');
    expect(failedLabel).toHaveClass('text-status-error');
    const failedRow = failedLabel.closest('li');
    expect(failedRow).toHaveClass('border-status-error/25');

    const pendingLabel = canvas.getByText('Czyszczenie tymczasowych plików');
    expect(pendingLabel).toHaveClass('text-fg-muted');
  },
};
