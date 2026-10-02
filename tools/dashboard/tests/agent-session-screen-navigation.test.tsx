// Behavioral regression for AgentSessionScreen's handling of a session that is briefly
// absent from the cached agent-sessions list — the exact situation after an explicit
// deterministic execution action admits a brand-new session (workflow session policy:
// fresh) and the UI follows it immediately, before anything has invalidated the
// sessions query cache (the admission request is a plain fetch, not a React Query
// mutation, so useCreateAgentSession's own onSuccess invalidation never runs for it).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useRouter: () => ({ history: { canGoBack: () => false, length: 1, back: vi.fn() } }),
  Link: ({ children }: any) => children,
}));

const SPEC = {
  specId: 'spec-1',
  slug: 'spec-1',
  source: 'active',
  title: 'Test Spec',
  status: 'in-implementation',
  metrics: { progress: 0, total: 0, completed: 0, inImplementation: 0, inReview: 0, ready: 0, stageCounts: {} as any },
  lanes: [],
  tasks: [],
} as any;

vi.mock('@/features/specifications/queries', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useSpecificationIndex: () => ({
      data: { active: [SPEC], archive: [] },
      loading: false,
      error: null,
    }),
  };
});

vi.mock('@/features/specifications/detail/spec-detail-queries', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useSpecificationActions: () => ({
      data: { workflowMode: 'deterministic', tasks: {} },
      refresh: vi.fn(),
    }),
  };
});

// AgentSessionPage's own internals (providers, chat snapshot, SSE) are irrelevant to
// this screen-level cache/navigation behavior — stub it to a minimal marker so this
// test stays focused on AgentSessionScreen's own missing-session handling.
vi.mock('@/features/agent-sessions/agent-session-page', () => ({
  AgentSessionPage: ({ session }: any) => <div data-testid="agent-session-page">{session.sessionId}</div>,
}));

import { AgentSessionScreen } from '../ui/screens/agent-session/agent-session-screen';

const SESSION_A = { sessionId: 'session-a', provider: 'claude', specId: 'spec-1', purpose: 'execution' };
const SESSION_B = { sessionId: 'session-b', provider: 'claude', specId: 'spec-1', purpose: 'execution' };

function mockSessionsFetch(sequence: Array<Array<typeof SESSION_A> | 'error'>) {
  let call = 0;
  (global as any).fetch = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/agent-sessions')) {
      const entry = sequence[Math.min(call, sequence.length - 1)];
      call += 1;
      if (entry === 'error') {
        return { ok: false, status: 500, json: async () => ({}) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ sessions: entry }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
}

function renderScreen(sessionId: string, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentSessionScreen source="active" slug="spec-1" sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

describe('AgentSessionScreen: session missing from a stale cached sessions list', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('refetches once and resolves the route once a freshly-created session appears, never rendering "Sesja nie znaleziona"', async () => {
    // Cached sessions list currently contains only A (as it would right after an
    // explicit Start Agent Step from A admitted a fresh session B server-side, before
    // this screen ever re-fetched).
    mockSessionsFetch([[SESSION_A], [SESSION_A, SESSION_B]]);

    renderScreen('session-b', queryClient);

    // Must never show the not-found state while the one authoritative refetch is
    // still in flight/pending.
    expect(screen.queryByText('Sesja nie znaleziona')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('agent-session-page')).toHaveTextContent('session-b');
    });

    expect(screen.queryByText('Sesja nie znaleziona')).not.toBeInTheDocument();
    // Exactly one extra fetch for the retry — not a polling loop.
    expect((global.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).startsWith('/api/agent-sessions?')).length).toBe(2);
  });

  it('still renders "Sesja nie znaleziona" for a genuinely invalid sessionId after the one retry (no infinite loading)', async () => {
    mockSessionsFetch([[SESSION_A], [SESSION_A]]);

    renderScreen('session-does-not-exist', queryClient);

    await waitFor(() => {
      expect(screen.getByText('Sesja nie znaleziona')).toBeInTheDocument();
    });
    expect((global.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).startsWith('/api/agent-sessions?')).length).toBe(2);
  });

  it('must NOT render "Sesja nie znaleziona" when the one authoritative retry itself fails — exposes a retryable error instead, then resolves on manual retry', async () => {
    // Cache has only A; the one-shot retry for B fails (network/server error) rather
    // than authoritatively confirming B's absence. useAgentSessions itself configures
    // retry: 1, so a genuinely-failing backend fails both that automatic internal retry
    // attempt and the original one before the error ever surfaces to this component.
    mockSessionsFetch([[SESSION_A], 'error', 'error', [SESSION_A, SESSION_B]]);

    renderScreen('session-b', queryClient);

    // useAgentSessions's own retry: 1 means a genuinely-failing fetch only surfaces as
    // an error to this component after its one built-in automatic retry (~1s backoff)
    // also fails — a fixed, bounded delay inherent to that pre-existing hook
    // configuration, not a poll/retry loop added by this fix.
    await waitFor(
      () => {
        expect(screen.getByText('Nie udało się wczytać sesji specyfikacji')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    // Must never claim the session does not exist — the server never said that; the
    // refetch itself just failed.
    expect(screen.queryByText('Sesja nie znaleziona')).not.toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /Spróbuj ponownie/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByTestId('agent-session-page')).toHaveTextContent('session-b');
    });
    expect(screen.queryByText('Sesja nie znaleziona')).not.toBeInTheDocument();
  });

  it('renders the existing session immediately with no extra refetch when it is already present in the cache', async () => {
    mockSessionsFetch([[SESSION_A]]);

    renderScreen('session-a', queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('agent-session-page')).toHaveTextContent('session-a');
    });
    expect(screen.queryByText('Sesja nie znaleziona')).not.toBeInTheDocument();
    expect((global.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).startsWith('/api/agent-sessions?')).length).toBe(1);
  });
});
