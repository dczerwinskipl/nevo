// Regression for ExecutionPolicySelectionDialog's provider selector: clicking a
// different, available provider must change the selection and keep it changed.
// Root cause (fixed alongside this test): the props-sync useEffect that initializes
// `provider`/`mode`/`model` from `initialConfig`/`initialPolicy` listed its own
// `provider` state as a dependency, so every user-driven `setProvider` call
// re-triggered the same effect, which unconditionally reapplied `initialConfig.provider`
// and silently reverted the click before the next paint.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ExecutionPolicySelectionDialog } from '../ui/features/agent-sessions/create-agent-session-dialog';
import type { AgentProviderDescriptor } from '../ui/features/agent-sessions/types';

const CAPABILITIES = { supportsAsk: true, supportsEdit: true, supportsAgent: true } as any;

const ANTIGRAVITY: AgentProviderDescriptor = {
  id: 'antigravity',
  label: 'Antigravity',
  enabled: true,
  available: true,
  capabilities: CAPABILITIES,
  supportedModes: ['agent'],
};

const CLAUDE: AgentProviderDescriptor = {
  id: 'claude',
  label: 'Claude',
  enabled: true,
  available: true,
  capabilities: CAPABILITIES,
  supportedModes: ['agent'],
};

function mockProvidersFetch(providers: AgentProviderDescriptor[]) {
  (global as any).fetch = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/agent-providers')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ providers, access: { mode: 'trusted-network', identityAuthenticated: false } }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  });
}

function renderDialog(props: Partial<React.ComponentProps<typeof ExecutionPolicySelectionDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ExecutionPolicySelectionDialog
        specificationTitle="Test Spec"
        onClose={onClose}
        onConfirm={onConfirm}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onConfirm, onClose };
}

describe('ExecutionPolicySelectionDialog: provider selection', () => {
  it('lets the user switch away from a preselected provider, and the selection stays changed', async () => {
    mockProvidersFetch([ANTIGRAVITY, CLAUDE]);

    renderDialog({ isOneOff: true, initialConfig: { provider: 'antigravity', mode: 'agent' } });

    const antigravityButton = await screen.findByRole('button', { name: /Antigravity/i });
    const claudeButton = await screen.findByRole('button', { name: /Claude/i });

    expect(antigravityButton).toHaveAttribute('aria-pressed', 'true');
    expect(claudeButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(claudeButton);

    // Must actually change — not revert on the next render/effect pass.
    await waitFor(() => {
      expect(claudeButton).toHaveAttribute('aria-pressed', 'true');
    });
    expect(antigravityButton).toHaveAttribute('aria-pressed', 'false');

    // Stays changed — give any stray effect another tick to (incorrectly) fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(claudeButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('still initializes from initialConfig when provided', async () => {
    mockProvidersFetch([ANTIGRAVITY, CLAUDE]);
    renderDialog({ isOneOff: true, initialConfig: { provider: 'claude', mode: 'agent' } });

    const claudeButton = await screen.findByRole('button', { name: /Claude/i });
    expect(claudeButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('still initializes from initialPolicy.default when no initialConfig is given', async () => {
    mockProvidersFetch([ANTIGRAVITY, CLAUDE]);
    renderDialog({
      initialPolicy: { default: { provider: 'claude', mode: 'agent' } } as any,
    });

    const claudeButton = await screen.findByRole('button', { name: /Claude/i });
    expect(claudeButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('still falls back to the first available provider when neither initialConfig nor initialPolicy is given', async () => {
    mockProvidersFetch([ANTIGRAVITY, CLAUDE]);
    renderDialog({});

    const antigravityButton = await screen.findByRole('button', { name: /Antigravity/i });
    expect(antigravityButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('submits the newly selected provider, not the originally preselected one', async () => {
    mockProvidersFetch([ANTIGRAVITY, CLAUDE]);
    const { onConfirm } = renderDialog({
      isOneOff: true,
      initialConfig: { provider: 'antigravity', mode: 'agent' },
    });

    const claudeButton = await screen.findByRole('button', { name: /Claude/i });
    fireEvent.click(claudeButton);
    await waitFor(() => expect(claudeButton).toHaveAttribute('aria-pressed', 'true'));

    const submitButton = screen.getByRole('button', { name: /Uruchom jednorazowo|Zatwierdź i rozpocznij/i });
    fireEvent.click(submitButton);

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude' }));
  });
});
