import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  SessionChoiceSelector,
  SessionChoiceDialog,
} from '../ui/features/specifications/tasks/session-choice';
import { ExecutionPolicySelectionDialog } from '../ui/features/agent-sessions/create-agent-session-dialog';
import type { WorkflowSessionChoice } from '../ui/features/specifications/types';
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

function mockProvidersFetch(providers: AgentProviderDescriptor[] = [ANTIGRAVITY]) {
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

describe('SessionChoiceDialog & SessionChoiceSelector', () => {
  const sampleChoice: WorkflowSessionChoice = {
    default: 'reuse',
    allowed: ['reuse', 'fresh'],
    candidate: {
      sessionId: 'sess-impl-42',
      sessionName: 'Implementation Turn 1',
      label: 'Sesja implementacji (sess-impl-42)',
    },
    unavailableReason: null,
  };

  it('with default: reuse, opens with continue selected and shows candidate label', () => {
    render(
      <SessionChoiceDialog
        open={true}
        specificationTitle="Test Specification"
        sessionChoice={sampleChoice}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const reuseButton = screen.getByRole('button', { name: /Kontynuuj w sesji/i });
    const freshButton = screen.getByRole('button', { name: /Nowa sesja/i });

    expect(reuseButton).toHaveAttribute('aria-pressed', 'true');
    expect(freshButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Sesja implementacji (sess-impl-42)')).toBeInTheDocument();
  });

  it('confirming continue posts sessionPolicy: reuse with candidate id', async () => {
    const onConfirm = vi.fn();
    render(
      <SessionChoiceDialog
        open={true}
        specificationTitle="Test Specification"
        sessionChoice={sampleChoice}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const startButton = screen.getByRole('button', { name: /^Start$/i });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        sessionPolicy: 'reuse',
        sessionId: 'sess-impl-42',
      });
    });
  });

  it('confirming new posts sessionPolicy: fresh without sessionId', async () => {
    const onConfirm = vi.fn();
    render(
      <SessionChoiceDialog
        open={true}
        specificationTitle="Test Specification"
        sessionChoice={sampleChoice}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const freshButton = screen.getByRole('button', { name: /Nowa sesja/i });
    fireEvent.click(freshButton);

    const startButton = screen.getByRole('button', { name: /^Start$/i });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        sessionPolicy: 'fresh',
        sessionId: undefined,
      });
    });
  });

  it('choosing continue on a review step shows the independence warning without blocking', async () => {
    render(
      <SessionChoiceDialog
        open={true}
        specificationTitle="Test Specification"
        sessionChoice={sampleChoice}
        isReviewStep={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/zmniejsza niezależność przeglądu/i),
    ).toBeInTheDocument();

    // Switching to fresh removes warning
    const freshButton = screen.getByRole('button', { name: /Nowa sesja/i });
    fireEvent.click(freshButton);

    expect(
      screen.queryByText(/zmniejsza niezależność przeglądu/i),
    ).not.toBeInTheDocument();
  });

  it('an unavailable reuse is disabled with its reason and defaults to fresh', () => {
    const unavailableChoice: WorkflowSessionChoice = {
      default: 'reuse',
      allowed: ['reuse', 'fresh'],
      candidate: {
        sessionId: 'sess-impl-42',
        sessionName: 'Implementation Turn 1',
        label: 'Sesja implementacji (sess-impl-42)',
      },
      unavailableReason: {
        code: 'PROVIDER_MISMATCH',
        message: 'Kandydat używał claude, a obecna konfiguracja to antigravity.',
      },
    };

    render(
      <SessionChoiceDialog
        open={true}
        specificationTitle="Test Specification"
        sessionChoice={unavailableChoice}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const reuseButton = screen.getByRole('button', { name: /Kontynuuj w sesji/i });
    expect(reuseButton).toBeDisabled();
    expect(
      screen.getByText(/Kandydat używał claude, a obecna konfiguracja to antigravity/i),
    ).toBeInTheDocument();

    const freshButton = screen.getByRole('button', { name: /Nowa sesja/i });
    expect(freshButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('a rejected start shows its error in the dialog and does not crash or silently close', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('SESSION_POLICY_NOT_ALLOWED: reuse is not permitted'));
    const onClose = vi.fn();

    render(
      <SessionChoiceDialog
        open={true}
        specificationTitle="Test Specification"
        sessionChoice={sampleChoice}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    const startButton = screen.getByRole('button', { name: /^Start$/i });
    fireEvent.click(startButton);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/SESSION_POLICY_NOT_ALLOWED/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a single-policy transition renders no choice', () => {
    const singleFreshChoice: WorkflowSessionChoice = {
      default: 'fresh',
      allowed: ['fresh'],
      candidate: null,
      unavailableReason: null,
    };

    const onChange = vi.fn();
    render(
      <SessionChoiceSelector
        sessionChoice={singleFreshChoice}
        value="fresh"
        onChange={onChange}
      />,
    );

    // Reuse button is not rendered when allowed only contains fresh
    expect(screen.queryByRole('button', { name: /Kontynuuj w sesji/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nowa sesja/i })).toBeInTheDocument();
  });
});

describe('ExecutionPolicySelectionDialog sessionChoice integration', () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const sampleChoice: WorkflowSessionChoice = {
    default: 'reuse',
    allowed: ['reuse', 'fresh'],
    candidate: {
      sessionId: 'sess-impl-42',
      sessionName: 'Implementation Turn 1',
      label: 'Sesja implementacji (sess-impl-42)',
    },
    unavailableReason: null,
  };

  it('renders SessionChoiceSelector when sessionChoice allows multiple policies and passes policy on confirm', async () => {
    mockProvidersFetch([ANTIGRAVITY]);
    const onConfirm = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <ExecutionPolicySelectionDialog
          specificationTitle="Test Spec"
          onClose={vi.fn()}
          onConfirm={onConfirm}
          isOneOff={true}
          initialConfig={{ provider: 'antigravity', mode: 'agent' }}
          sessionChoice={sampleChoice}
        />
      </QueryClientProvider>,
    );

    const reuseButton = await screen.findByRole('button', { name: /Kontynuuj w sesji/i });
    expect(reuseButton).toBeInTheDocument();
    expect(reuseButton).toHaveAttribute('aria-pressed', 'true');

    const submitButton = screen.getByRole('button', { name: /Uruchom jednorazowo/i });
    fireEvent.click(submitButton);

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionPolicy: 'reuse',
        sessionId: 'sess-impl-42',
      }),
    );
  });
});
