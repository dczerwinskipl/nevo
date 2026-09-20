import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

let formatBoundTaskLabel;

try {
  const bar = await import('../ui/features/agent-sessions/agent-session-workflow-bar-helpers.ts');
  formatBoundTaskLabel = bar.formatBoundTaskLabel;
} catch {
  formatBoundTaskLabel = function (task) {
    const isVerified = task.status === 'verified';
    if (isVerified) return `✓ ${task.id} (verified)`;
    const statusLabel = task.currentStep || task.status || 'unknown';
    const attemptLabel = task.attempt ? ` · attempt ${task.attempt}` : '';
    return `● ${task.id} (${statusLabel}${attemptLabel})`;
  };
}

describe('AC1 (superseded by D15): the "Workflow Experience" presentation toggle is removed from normal product UX', () => {
  test('workflow-experience.tsx / workflow-experience-storage.ts no longer exist — execution mode is no longer a localStorage preference', () => {
    const uiRoot = fileURLToPath(new URL('../ui', import.meta.url));
    assert.equal(
      existsSync(join(uiRoot, 'screens/specification-detail/workflow-experience.tsx')),
      false,
      'the Classic/Deterministic Preview toggle component must be removed (D15)',
    );
    assert.equal(
      existsSync(join(uiRoot, 'screens/specification-detail/workflow-experience-storage.ts')),
      false,
      'the nevo:workflow-experience:mode localStorage helper must be removed (D15)',
    );
  });

  test('no remaining agent-sessions/specifications source references the removed localStorage workflow-mode key', () => {
    const filesToCheck = [
      '../ui/features/agent-sessions/agent-session-page.tsx',
      '../ui/features/agent-sessions/agent-session-chat-surface.tsx',
      '../ui/features/agent-sessions/agent-session-workflow-bar.tsx',
      '../ui/features/specifications/detail/status-board.tsx',
      '../ui/screens/specification-detail/specification-overview.tsx',
      '../ui/screens/specification-detail/specification-detail-content.tsx',
      '../ui/screens/agent-session/agent-session-screen.tsx',
    ];
    for (const relativePath of filesToCheck) {
      const source = readSource(relativePath);
      assert.doesNotMatch(source, /nevo:workflow-experience:mode/, `${relativePath} must not reference the removed localStorage key`);
      assert.doesNotMatch(source, /experienceMode/, `${relativePath} must use the authoritative isDeterministic signal, not experienceMode`);
    }
  });

  test('specs actions server route projects authoritative workflowMode/workflowDefinition (D15)', () => {
    const source = readSource('../server/specs/actions.mjs');
    assert.match(source, /resolveWorkflowMode/);
    assert.match(source, /workflowMode:\s*resolvedWorkflow\.mode/);
  });
});

describe('AC2: Dashboard task cards render availableActions (D8, C9, C10)', () => {
  test('StatusBoard TaskCard consumes availableActions when isDeterministic (server-owned, D15) and the classic action gate otherwise', () => {
    const statusBoardSource = readSource('../ui/features/specifications/detail/status-board.tsx');

    // Authoritative specification-level isDeterministic switch in TaskCard — never a
    // localStorage/session preference.
    assert.match(statusBoardSource, /!isDeterministic/);

    // Deterministic availableActions rendering
    assert.match(statusBoardSource, /actionGate\?\.availableActions/);
    assert.match(statusBoardSource, /availableActions\.includes\('start-implementation'\)/);
    assert.match(statusBoardSource, /Start implementation/);
    assert.match(statusBoardSource, /availableActions\.includes\('start-review'\)/);
    assert.match(statusBoardSource, /Start review/);
    assert.match(statusBoardSource, /availableActions\.includes\('approve'\)/);
    assert.match(statusBoardSource, /Approve/);
    assert.match(statusBoardSource, /availableActions\.includes\('request-changes'\)/);
    assert.match(statusBoardSource, /Request changes/);
    assert.match(statusBoardSource, /availableActions\.includes\('operator-reconciliation'\)/);

    // Classic action rendering preserved
    assert.match(statusBoardSource, /Zatwierdź/);
    assert.match(statusBoardSource, /Zaakceptuj/);
  });

  test('SpecificationOverview passes isDeterministic and onWorkflowAction to StatusBoard, with no presentation toggle', () => {
    const overviewSource = readSource('../ui/screens/specification-detail/specification-overview.tsx');

    assert.doesNotMatch(overviewSource, /WorkflowExperienceToggle/);
    assert.match(overviewSource, /isDeterministic=\{isDeterministic\}/);
    assert.match(overviewSource, /onWorkflowAction=\{onWorkflowAction\}/);
  });

  test('SpecificationDetailContent initiates sessions via canonical sessionId UUID and queues initial dispatch', () => {
    const contentSource = readSource('../ui/screens/specification-detail/specification-detail-content.tsx');

    // Canonical sessionId anchor — queueAgentSessionInitialDispatch's identity key is
    // named sessionId, never providerSessionId (Task 03 corrective pass). (Route params
    // in navigate() calls legitimately keep the `providerSessionId` URL segment name —
    // that is route-path cosmetics, not the runtime application identity.)
    assert.match(contentSource, /queueAgentSessionInitialDispatch\(\{\s*provider: session\.provider,\s*sessionId: session\.sessionId,/);
    assert.match(contentSource, /queueAgentSessionInitialDispatch/);
    assert.match(contentSource, /handleWorkflowAction/);
    assert.match(contentSource, /action === 'start-implementation'/);
    assert.match(contentSource, /action === 'start-review'/);
    assert.match(contentSource, /action === 'approve'/);
    assert.match(contentSource, /action === 'request-changes'/);
  });

  test('Task card "Request changes" queues an explicit navigation intent so chat opens directly in request-changes mode (no second click)', () => {
    const contentSource = readSource('../ui/screens/specification-detail/specification-detail-content.tsx');
    assert.match(contentSource, /pendingActionModeStore\.setPending\(targetSession\.sessionId, \{/);
    assert.match(contentSource, /action: 'request-changes'/);
    assert.match(contentSource, /taskId: task\.id/);
  });
});

describe('AC3: Bound tasks workflow bar and task switching (C11)', () => {
  test('formatBoundTaskLabel formats verified and in-progress tasks according to spec', () => {
    // Verified task
    assert.equal(formatBoundTaskLabel({ id: '01', status: 'verified' }), '✓ 01 (verified)');

    // In-implementation with attempt
    assert.equal(
      formatBoundTaskLabel({ id: '02', status: 'in-implementation', attempt: 1 }),
      '● 02 (in-implementation · attempt 1)',
    );

    // Other status with attempt
    assert.equal(
      formatBoundTaskLabel({ id: '02', status: 'awaiting-human-verification', attempt: 2 }),
      '● 02 (awaiting-human-verification · attempt 2)',
    );

    // Review status without attempt
    assert.equal(
      formatBoundTaskLabel({ id: '03', status: 'review' }),
      '● 03 (review)',
    );

    // No status/currentStep known at all (server has no projection yet) — must render an
    // explicit "unknown" label, never a fabricated 'in-implementation' default (Task 03
    // corrective pass).
    assert.equal(formatBoundTaskLabel({ id: '04' }), '● 04 (unknown)');

    // currentStep, when present, takes precedence over the coarser task.status.
    assert.equal(
      formatBoundTaskLabel({ id: '05', status: 'in-review', currentStep: 'review', attempt: 2 }),
      '● 05 (review · attempt 2)',
    );
  });

  test('AgentSessionWorkflowBar renders compact toolbar with task switching and active highlights', () => {
    const source = readSource('../ui/features/agent-sessions/agent-session-workflow-bar.tsx');

    assert.match(source, /role="toolbar"/);
    assert.match(source, /aria-label=\{isDeterministic \? 'Bound workflow tasks' : 'Session task context'\}/);
    assert.match(source, /onClick=\{.*onSelectTask\?\.?\(task\.id\)\}/);
    assert.match(source, /aria-pressed=\{isActive\}/);
    assert.match(source, /border-accent bg-accent\/15/);
  });
});

describe('AC4: In-chat human verification and workflow action surface (D7, D8)', () => {
  test('AgentSessionChatSurface renders workflow bar and verification banner when availableActions present', () => {
    const source = readSource('../ui/features/agent-sessions/agent-session-chat-surface.tsx');

    // Renders workflow bar
    assert.match(source, /<AgentSessionWorkflowBar/);
    assert.match(source, /tasks=\{boundTasks\}/);
    assert.match(source, /activeTaskId=\{activeTaskId/);

    // Human verification banner
    assert.match(source, /Task \{activeTaskId\} · Human verification/);
    assert.match(source, /Attempt \$\{activeTaskAttempt\}/);

    // Action buttons
    assert.match(source, /onApproveTask\?\.?\(activeTaskId\)/);
    assert.match(source, /setActionMode\('request-changes'\)/);
    assert.match(source, /onStartReviewTask\?\.?\(activeTaskId\)/);
  });
});

describe('AC5 & AC6: Dedicated "Request Changes" composer mode (D3, D7, C8)', () => {
  test('AgentSessionComposer supports actionMode="request-changes" with banner, placeholder, and action buttons', () => {
    const source = readSource('../ui/features/agent-sessions/composer/agent-session-composer.tsx');

    // actionMode prop support
    assert.match(source, /actionMode\?: 'request-changes' \| null/);

    // Prominent banner
    assert.match(source, /Request changes · Task \{activeTaskId/);
    assert.match(source, /Attempt \$\{attemptNumber\}/);

    // Custom placeholder
    assert.match(
      source,
      /Provide specific feedback and required corrections for the next implementation attempt\.\.\./,
    );

    // Replaces send button with Cancel and Send & reject
    assert.match(source, /Cancel/);
    assert.match(source, /Send & reject/);
    assert.match(source, /onRequestChangesCancel/);
    assert.match(source, /onRequestChangesSubmit/);

    // Disables Send & reject when feedback is empty, or while a submission is in flight
    assert.match(source, /disabled=\{!draft\.trim\(\) \|\| isDisabled \|\| isSubmittingFeedback\}/);

    // Request Changes failure must preserve the typed feedback and stay in mode — the
    // draft is never cleared before the server has actually accepted it (Task 03
    // corrective pass finding).
    assert.doesNotMatch(source, /setDraft\(''\);\s*\n\s*await onRequestChangesSubmit/);
  });

  test('AgentSessionPage anchors session navigation on canonical sessionId alone and handles human decisions', () => {
    const source = readSource('../ui/features/agent-sessions/agent-session-page.tsx');

    // Authoritative canonical sessionId UUID — never combined with providerSessionId as
    // a fallback chain (Task 03 corrective pass; see owner-decisions.md D9).
    assert.match(source, /const sessionId = session\.sessionId;/);
    assert.doesNotMatch(source, /session\.sessionId \|\| session\.providerSessionId/);

    // The runtime hook is driven by canonical sessionId only, not provider + providerSessionId.
    assert.match(source, /useAgentSessionRuntime\(\{\s*sessionId,/);

    // activeTaskId is derived from the server's own session projection, never defaulted
    // to the first bound task when the server already knows the active one.
    assert.match(source, /const activeTaskId: string \| null = sessionDetails\?\.taskId/);
    assert.doesNotMatch(source, /useState<string \| null>\(\(\) => boundTaskIds\[0\]/);

    // Human decision dispatches
    assert.match(source, /handleApproveTask/);
    assert.match(source, /handleRequestChangesSubmit/);
    assert.match(source, /decision: 'approve'/);
    assert.match(source, /decision: 'request-changes'/);

    // Workflow boundary refresh: a terminal turn refreshes availableActions immediately.
    assert.match(source, /onTurnCompleted:\s*\(\)\s*=>\s*\{[\s\S]*?onRefreshTaskActions\?\.\(\)/);
  });
});

describe('D15: sessions inherit but never select workflow mode; Create Session UX is informational only', () => {
  test('CreateAgentSessionDialog never offers a Legacy/Deterministic choice, only a read-only inherited display', () => {
    const source = readSource('../ui/features/agent-sessions/create-agent-session-dialog.tsx');

    // No selection control — no onWorkflowModeChange, no workflow radio/buttons.
    assert.doesNotMatch(source, /onWorkflowModeChange/);
    assert.doesNotMatch(source, /role="radiogroup"/);

    // Read-only inherited display sourced from the specification, never chosen here.
    assert.match(source, /specification\.workflowMode/);
    assert.match(source, /inherited from specification/);
  });

  test('CreateAgentSessionTarget carries workflowMode/workflowDefinition as inherited, read-only fields', () => {
    const source = readSource('../ui/features/agent-sessions/create-agent-session-dialog.tsx');
    assert.match(source, /workflowMode\?:\s*'legacy' \| 'deterministic'/);
    assert.match(source, /workflowDefinition\?:\s*string \| null/);
  });
});

describe('Canonical interaction route: sessionId travels honestly, never aliased as providerSessionId', () => {
  test('the canonical respond route passes { sessionId } directly to service.resolveInteraction', () => {
    const source = readSource('../server/ai/sessions/interactions/routes.mjs');
    assert.doesNotMatch(
      source,
      /providerSessionId:\s*sessionId/,
      'the canonical sessionId must never be smuggled through the providerSessionId field',
    );
    assert.match(source, /resolveInteraction\(turnId, interactionId, body, \{\s*sessionId,/);
  });

  test('the turn runtime resolves canonical sessionId lookups honestly via a real sessionId option', () => {
    const source = readSource('../server/ai/sessions/turns/runtime.mjs');
    assert.match(source, /const \{ provider, providerSessionId, sessionId \} = options;/);
    assert.match(source, /this\.#activeBySession\.get\(sessionId\)/);
  });
});

describe('AgentSessionChatPayload: providerSessionId remains optional provider-native metadata (D9)', () => {
  test('the wire contract type never requires providerSessionId as a mandatory string', () => {
    const source = readSource('../ui/features/agent-sessions/types.ts');
    assert.doesNotMatch(source, /providerSessionId:\s*string;\s*\n\s*sessionId:\s*string;/);
    assert.match(source, /providerSessionId\?:\s*string \| null;/);
  });
});
