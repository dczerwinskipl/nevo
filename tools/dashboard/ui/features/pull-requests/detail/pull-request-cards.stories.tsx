import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { PullRequestSummaryCard } from './pull-request-cards';
import type { AvailablePullRequest } from '../types';

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

function PullRequestGallery() {
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
}

const meta: Meta<typeof PullRequestSummaryCard> = {
  title: 'Features/Pull Requests/Summary Card',
  component: PullRequestSummaryCard,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const PullRequestStatusTones: Story = {
  render: () => <PullRequestGallery />,
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

    // Additions & deletions classes (updated for diff tokens)
    const additionsEl = canvas.getAllByText('+142')[0];
    expect(additionsEl).toHaveClass('text-diff-addition');

    const deletionsEl = canvas.getAllByText('−12')[0];
    expect(deletionsEl).toHaveClass('text-diff-deletion');
  },
};
