import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readTypesSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/types.ts', import.meta.url)), 'utf8');
}

function readAgentSessionListSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/agent-session-list.tsx', import.meta.url)), 'utf8');
}

function readAgentSessionPageSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/agent-session-page.tsx', import.meta.url)), 'utf8');
}

test('Task 09: AgentSessionStatus type is narrowed to exactly idle | running | waitingForUser', () => {
  const typesSource = readTypesSource();

  // AgentSessionStatus definition contains only live states
  const sessionStatusMatch = typesSource.match(/export type AgentSessionStatus = ([^;]+);/);
  assert.ok(sessionStatusMatch, 'AgentSessionStatus definition found');
  const sessionStatusDef = sessionStatusMatch[1];
  assert.equal(sessionStatusDef, "'idle' | 'running' | 'waitingForUser'");
  assert.doesNotMatch(sessionStatusDef, /'completed'/);
  assert.doesNotMatch(sessionStatusDef, /'failed'/);
  assert.doesNotMatch(sessionStatusDef, /'stopped'/);
});

test('Task 09: agent-session-list.tsx removed dead completed branches and list grouping', () => {
  const sessionListSource = readAgentSessionListSource();

  // statusLabel handles running, waitingForUser, and default Bezczynna — no completed case
  assert.match(sessionListSource, /status === 'running'/);
  assert.match(sessionListSource, /status === 'waitingForUser'/);
  assert.doesNotMatch(sessionListSource, /status === 'completed'/);
  assert.doesNotMatch(sessionListSource, /Zakończona/);

  // List renders as one flat, ungrouped list — no "Aktualne"/"Zakończone" split
  assert.doesNotMatch(sessionListSource, /Aktualne/);
  assert.doesNotMatch(sessionListSource, /Zakończone/);

  // No CheckCircle2 completed icon branch in row
  assert.doesNotMatch(sessionListSource, /CheckCircle2/);
});

test('Task 09: agent-session-page.tsx removed dead session.status === completed check on composer', () => {
  const chatSource = readAgentSessionPageSource();

  // Composer is not disabled by dead session.status === 'completed'
  assert.doesNotMatch(chatSource, /session\?\.status === 'completed'/);
  assert.doesNotMatch(chatSource, /session\.status === 'completed'/);
  assert.doesNotMatch(chatSource, /session\?\.status === 'failed'/);
  assert.doesNotMatch(chatSource, /session\.status === 'failed'/);
});
