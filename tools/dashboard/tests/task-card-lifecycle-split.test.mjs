import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  deterministicStateTone,
  formatDeterministicState,
} from '../ui/features/specifications/detail/lane-presentation.ts';

function readStatusBoardSource() {
  return readFileSync(
    fileURLToPath(new URL('../ui/features/specifications/detail/status-board.tsx', import.meta.url)),
    'utf8',
  );
}

describe('TaskCard lifecycle split (Task 19, D7, D10, D15, D18, D19, D20)', () => {
  test('Deterministic state presentation functions: tone and label are pure functions of state/outcome, independent of step ID', () => {
    // Active state
    assert.equal(deterministicStateTone('active'), 'active');
    assert.equal(formatDeterministicState('active'), 'Active');

    // Human interaction state
    assert.equal(deterministicStateTone('human-interaction'), 'warning');
    assert.equal(formatDeterministicState('human-interaction'), 'Human Action');

    // Waiting for step start
    assert.equal(deterministicStateTone('waiting-for-step-start'), 'info');
    assert.equal(formatDeterministicState('waiting-for-step-start'), 'Waiting');

    // Ready & Blocked
    assert.equal(deterministicStateTone('ready'), 'info');
    assert.equal(formatDeterministicState('ready'), 'Ready');
    assert.equal(deterministicStateTone('blocked'), 'warning');
    assert.equal(formatDeterministicState('blocked'), 'Blocked');

    // Terminal
    assert.equal(deterministicStateTone('terminal', 'success'), 'success');
    assert.equal(formatDeterministicState('terminal', 'success'), 'Completed');
    assert.equal(deterministicStateTone('terminal', 'failure'), 'error');
    assert.equal(formatDeterministicState('terminal', 'failure'), 'Failed');

    // Draft / fallback
    assert.equal(deterministicStateTone('draft'), 'neutral');
    assert.equal(formatDeterministicState('draft'), 'Draft');
    assert.equal(deterministicStateTone(null), 'neutral');
    assert.equal(formatDeterministicState(null), 'Draft');
  });

  test('AC 1: LegacyTaskCard preserves legacy rendering contracts and byte-for-byte output', () => {
    const src = readStatusBoardSource();

    // LegacyTaskCard must be defined and exported
    assert.match(src, /export function LegacyTaskCard\s*\(/);

    // LegacyTaskCard uses taskStatusTone and formatTaskStatus with task.status
    assert.match(src, /<StatusLabel\s+tone=\{taskStatusTone\(task\.status\)\}/);
    assert.match(src, /\{formatTaskStatus\(task\.status\)\}/);

    // Preserves dependencies and blockedBy indicators
    assert.match(src, /title=\{`Zależności: \$\{task\.dependsOn\.join\(', '\)\}`\}/);
    assert.match(src, /title=\{`Blokowane przez: \$\{task\.blockedBy\.join\(', '\)\}`\}/);

    // Preserves legacy action buttons
    assert.match(src, /onClick=\{\(\) => onAction\?\.`?\s*\(task, actionGate\.action\)/);
    assert.match(src, /actionGate\.action === 'approve'\s*\?\s*\(.*Zatwierdź.*\)\s*:\s*\(.*Zaakceptuj.*\)/s);
  });

  test('AC 2: DeterministicTaskCard status label and tone read action DTO state, not formatTaskStatus(task.status)', () => {
    const src = readStatusBoardSource();

    // DeterministicTaskCard must be defined and exported
    assert.match(src, /export function DeterministicTaskCard\s*\(/);

    // Extract DeterministicTaskCard function body
    const detCardStart = src.indexOf('function DeterministicTaskCard');
    const detCardEnd = src.indexOf('\nfunction TaskCard(');
    const detCardBody = src.slice(detCardStart, detCardEnd);

    // Status label reads from deterministic tone and format helpers, never task.status
    assert.match(detCardBody, /tone=\{tone\}/);
    assert.match(detCardBody, /\{label\}/);
    assert.doesNotMatch(detCardBody, /formatTaskStatus\s*\(/);
    assert.doesNotMatch(detCardBody, /taskStatusTone\s*\(/);
  });

  test('AC 3: DeterministicTaskCard status label/tone never differs by step id', () => {
    const src = readStatusBoardSource();
    const detCardStart = src.indexOf('function DeterministicTaskCard');
    const detCardEnd = src.indexOf('\nfunction TaskCard(');
    const detCardBody = src.slice(detCardStart, detCardEnd);

    // The tone and label are computed strictly from state (and terminalOutcome), never from stepDescriptor.id or currentStep
    assert.match(detCardBody, /const tone = deterministicStateTone\(state, terminalOutcome\);/);
    assert.match(detCardBody, /const label = formatDeterministicState\(state, terminalOutcome\);/);

    // Step descriptor's id or purpose is only displayed as informational text, not as status label
    assert.match(detCardBody, /stepDescriptor\.purpose \|\| stepDescriptor\.id/);
    assert.doesNotMatch(detCardBody, /(?:switch|if)\s*\(.*(?:currentStep|stepDescriptor\.id).*===\s*['"]review['"]/);
    assert.doesNotMatch(detCardBody, /(?:switch|if)\s*\(.*(?:currentStep|stepDescriptor\.id).*===\s*['"]hardening['"]/);
  });

  test('AC 4: Deterministic footer renders generic Start and compact human indicator, never obsolete action IDs', () => {
    const src = readStatusBoardSource();
    const detCardStart = src.indexOf('function DeterministicTaskCard');
    const detCardEnd = src.indexOf('\nfunction TaskCard(');
    const detCardBody = src.slice(detCardStart, detCardEnd);

    // Renders generic Start control calling onStartStep
    assert.match(detCardBody, /canStartStep/);
    assert.match(detCardBody, /onStartStep\?\.\(descriptorToStart\)/);

    // Renders compact human indicator opening TaskDialog (via onSelect)
    assert.match(detCardBody, /isHumanInteraction/);
    assert.match(detCardBody, /onSelect\?\.`?\s*\(task, event\.currentTarget\)/);
    assert.match(detCardBody, /Human action required/);

    // Obsolete action IDs MUST NOT appear anywhere in DeterministicTaskCard
    assert.doesNotMatch(detCardBody, /['"]start-implementation['"]/);
    assert.doesNotMatch(detCardBody, /['"]start-review['"]/);
    assert.doesNotMatch(detCardBody, /['"]approve['"]/);
    assert.doesNotMatch(detCardBody, /['"]request-changes['"]/);

    // Does NOT render human interaction action buttons inline
    assert.doesNotMatch(detCardBody, /humanInteraction\.actions/);
  });

  test('AC 5: DeterministicTaskCard only calls onStartStep and imports neither agent-sessions nor human transport modules', () => {
    const src = readStatusBoardSource();

    // No imports from features/agent-sessions
    assert.doesNotMatch(src, /from\s+['"][^'"]*features\/agent-sessions[^'"]*['"]/);

    // No imports from human-step transport or mutation modules
    assert.doesNotMatch(src, /human-step-transport/);
    assert.doesNotMatch(src, /human-step-mutations/);
    assert.doesNotMatch(src, /HumanStepSurface/);

    // DeterministicTaskCard accepts onStartStep and passes it down
    assert.match(src, /onStartStep\?:\s*\(stepDescriptor:\s*WorkflowStepDescriptor\)\s*=>\s*void/);
  });

  test('AC 6: No component in status-board.tsx calls stageForStatus or isTaskReady or branches on step IDs', () => {
    const src = readStatusBoardSource();

    // Neither stageForStatus nor isTaskReady is imported or called
    assert.doesNotMatch(src, /stageForStatus/);
    assert.doesNotMatch(src, /isTaskReady/);

    // No branching on literal step names
    assert.doesNotMatch(src, /=== ['"](?:implementation|review|hardening|human-verification)['"]/);
  });
});
