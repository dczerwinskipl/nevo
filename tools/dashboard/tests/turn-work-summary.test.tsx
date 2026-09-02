import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TurnWorkSummary } from '../ui/features/agent-sessions/turn-work/turn-work-summary';
import type { TurnWork } from '../ui/features/agent-sessions/transcript/projection';

describe('TurnWorkSummary component (RTL renders)', () => {
  it('Coverage D: current activity label renders Task 04 normalized label, never raw tool name', () => {
    const work: TurnWork = {
      turnId: 'turn-1',
      messageId: 'm1',
      status: 'current',
      currentActivity: {
        toolId: 't1',
        toolName: 'Read',
        input: { path: 'specs/active/chat-ux-improvements-pt1/foo.md' },
        status: 'running',
      },
      items: [
        {
          toolId: 't1',
          toolName: 'Read',
          input: { path: 'specs/active/chat-ux-improvements-pt1/foo.md' },
          status: 'running',
        },
      ],
    };

    render(<TurnWorkSummary work={work} />);

    expect(screen.getByText('Reading specs/active/chat-ux-improvements-pt1/foo.md')).toBeInTheDocument();
    expect(screen.queryByText(/^Read$/)).not.toBeInTheDocument();
  });

  it('Coverage G: collapsed Work renders as a lightweight row with hover affordance, not a card container', () => {
    const work: TurnWork = {
      turnId: 'turn-1',
      messageId: 'm1',
      status: 'completed',
      hasFailures: false,
      items: [
        { toolId: 't1', toolName: 'Read', input: {}, status: 'completed' },
        { toolId: 't2', toolName: 'Bash', input: {}, status: 'completed' },
      ],
    };

    render(<TurnWorkSummary work={work} />);

    const button = screen.getByRole('button', { name: /work ·/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.className).toContain('hover:bg-white/4');
    expect(button.className).not.toContain('rounded-xl');
    expect(button.className).not.toContain('border');

    // Clicking expands the summary row
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('Coverage L: expanded Work renders turnError code and message without heuristics', () => {
    const work: TurnWork = {
      turnId: 'turn-1',
      messageId: 'm1',
      status: 'failed',
      hasFailures: true,
      turnError: {
        code: 'AI_SESSION_LIMIT',
        message: "You've hit your session limit",
      },
      items: [
        { toolId: 't1', toolName: 'Read', input: { path: 'a.ts' }, status: 'completed' },
      ],
    };

    render(<TurnWorkSummary work={work} />);

    // Expand
    const toggle = screen.getByRole('button', { name: /work ·/i });
    fireEvent.click(toggle);

    expect(screen.getByText("You've hit your session limit")).toBeInTheDocument();
    expect(screen.getByText(/AI_SESSION_LIMIT/)).toBeInTheDocument();
  });
});
