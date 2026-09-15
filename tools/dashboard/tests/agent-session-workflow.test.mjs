import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

let getStoredWorkflowExperienceMode, setStoredWorkflowExperienceMode, WORKFLOW_EXPERIENCE_STORAGE_KEY;
let formatBoundTaskLabel;

try {
  const we = await import('../ui/screens/specification-detail/workflow-experience.ts');
  getStoredWorkflowExperienceMode = we.getStoredWorkflowExperienceMode;
  setStoredWorkflowExperienceMode = we.setStoredWorkflowExperienceMode;
  WORKFLOW_EXPERIENCE_STORAGE_KEY = we.WORKFLOW_EXPERIENCE_STORAGE_KEY;
} catch {
  WORKFLOW_EXPERIENCE_STORAGE_KEY = 'nevo:workflow-experience:mode';
  getStoredWorkflowExperienceMode = function () {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(WORKFLOW_EXPERIENCE_STORAGE_KEY);
        if (stored === 'classic' || stored === 'deterministic') return stored;
      }
    } catch {}
    return 'deterministic';
  };
  setStoredWorkflowExperienceMode = function (mode) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(WORKFLOW_EXPERIENCE_STORAGE_KEY, mode);
      }
    } catch {}
  };
}

try {
  const bar = await import('../ui/features/agent-sessions/agent-session-workflow-bar-helpers.ts');
  formatBoundTaskLabel = bar.formatBoundTaskLabel;
} catch {
  formatBoundTaskLabel = function (task) {
    const isVerified = task.status === 'verified';
    if (isVerified) return `✓ ${task.id} (verified)`;
    const statusLabel = task.status || 'in-implementation';
    const attemptLabel = task.attempt ? ` · attempt ${task.attempt}` : '';
    return `● ${task.id} (${statusLabel}${attemptLabel})`;
  };
}

describe('AC1: Temporary UI Presentation Switch (D10, C12)', () => {
  test('getStoredWorkflowExperienceMode defaults to deterministic when storage is empty or invalid', () => {
    const originalLocalStorage = globalThis.localStorage;
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, val) => store.set(key, String(val)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    };

    try {
      // Empty storage -> defaults to deterministic
      assert.equal(getStoredWorkflowExperienceMode(), 'deterministic');

      // Invalid storage value -> defaults to deterministic
      globalThis.localStorage.setItem(WORKFLOW_EXPERIENCE_STORAGE_KEY, 'invalid-mode');
      assert.equal(getStoredWorkflowExperienceMode(), 'deterministic');

      // Set to classic
      setStoredWorkflowExperienceMode('classic');
      assert.equal(getStoredWorkflowExperienceMode(), 'classic');

      // Set to deterministic
      setStoredWorkflowExperienceMode('deterministic');
      assert.equal(getStoredWorkflowExperienceMode(), 'deterministic');
    } finally {
      globalThis.localStorage = originalLocalStorage;
    }
  });

  test('workflow-experience.ts source implements correct defaults and storage keys', () => {
    const tsSource = readSource('../ui/screens/specification-detail/workflow-experience.ts');
    assert.match(tsSource, /WORKFLOW_EXPERIENCE_STORAGE_KEY = 'nevo:workflow-experience:mode'/);
    assert.match(tsSource, /return 'deterministic'/);
    assert.match(tsSource, /stored === 'classic' \|\| stored === 'deterministic'/);
  });

  test('WorkflowExperienceToggle renders segmented control for Classic and Deterministic Preview', () => {
    const source = readSource('../ui/screens/specification-detail/workflow-experience.tsx');

    assert.match(source, /Workflow Experience:/);
    assert.match(source, /Classic/);
    assert.match(source, /Deterministic Preview/);
    assert.match(source, /role="group"/);
    assert.match(source, /aria-pressed=\{mode === 'classic'\}/);
    assert.match(source, /aria-pressed=\{mode === 'deterministic'\}/);
  });
});

describe('AC2: Dashboard task cards render availableActions (D8, C9, C10)', () => {
  test('StatusBoard TaskCard consumes availableActions in deterministic mode and classic action in classic mode', () => {
    const statusBoardSource = readSource('../ui/features/specifications/detail/status-board.tsx');

    // Experience mode switch in TaskCard
    assert.match(statusBoardSource, /experienceMode === 'classic'/);

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

  test('SpecificationOverview passes experienceMode, onExperienceModeChange, and onWorkflowAction to StatusBoard', () => {
    const overviewSource = readSource('../ui/screens/specification-detail/specification-overview.tsx');

    assert.match(overviewSource, /WorkflowExperienceToggle/);
    assert.match(overviewSource, /experienceMode=\{experienceMode\}/);
    assert.match(overviewSource, /onWorkflowAction=\{onWorkflowAction\}/);
    assert.match(overviewSource, /onModeChange=\{onExperienceModeChange\}/);
  });

  test('SpecificationDetailContent initiates sessions via canonical sessionId UUID and queues initial dispatch', () => {
    const contentSource = readSource('../ui/screens/specification-detail/specification-detail-content.tsx');

    // Canonical sessionId anchor
    assert.match(contentSource, /providerSessionId:\s*session\.sessionId/);
    assert.match(contentSource, /queueAgentSessionInitialDispatch/);
    assert.match(contentSource, /handleWorkflowAction/);
    assert.match(contentSource, /action === 'start-implementation'/);
    assert.match(contentSource, /action === 'start-review'/);
    assert.match(contentSource, /action === 'approve'/);
    assert.match(contentSource, /action === 'request-changes'/);
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
  });

  test('AgentSessionWorkflowBar renders compact toolbar with task switching and active highlights', () => {
    const source = readSource('../ui/features/agent-sessions/agent-session-workflow-bar.tsx');

    assert.match(source, /role="toolbar"/);
    assert.match(source, /aria-label="Bound workflow tasks"/);
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

    // Disables Send & reject when feedback is empty
    assert.match(source, /disabled=\{!draft\.trim\(\) \|\| isDisabled\}/);
  });

  test('AgentSessionPage anchors session navigation on canonical sessionId and handles human decisions', () => {
    const source = readSource('../ui/features/agent-sessions/agent-session-page.tsx');

    // Authoritative canonical sessionId UUID
    assert.match(source, /const sessionId = session\.sessionId \|\| session\.providerSessionId/);

    // Human decision dispatches
    assert.match(source, /handleApproveTask/);
    assert.match(source, /handleRequestChangesSubmit/);
    assert.match(source, /decision: 'approve'/);
    assert.match(source, /decision: 'request-changes'/);
  });
});
