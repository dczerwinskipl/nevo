import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentSessionTranscriptV2 } from '../ui/features/agent-sessions/work-v2/agent-session-transcript-v2';
import type { CanonicalTurnV2 } from '../ui/features/agent-sessions/types';

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
});
