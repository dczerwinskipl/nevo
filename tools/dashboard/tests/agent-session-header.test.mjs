import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readAgentSessionHeaderSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/agent-session-header.tsx', import.meta.url)), 'utf8');
}

function readAgentSessionPageSource() {
  return readFileSync(fileURLToPath(new URL('../ui/features/agent-sessions/agent-session-page.tsx', import.meta.url)), 'utf8');
}

test('Task 05 / Issue 4: AgentSessionHeader component contains only essentials (back, title, compact status, details)', () => {
  const source = readAgentSessionHeaderSource();

  // Navigation (back button)
  assert.match(source, /onClick=\{onBack\}/);
  assert.match(source, /ArrowLeft/);

  // Title
  assert.match(source, /\{title\}/);

  // Compact status badge
  assert.match(source, /\{status\}/);

  // Session details entry point (Info button)
  assert.match(source, /onClick=\{onOpenDetails\}/);
  assert.match(source, /Info/);

  // Stop/Cancel is NOT in the header — primary cancel affordance lives in AgentSessionComposer
  assert.doesNotMatch(source, /CircleStop/);
  assert.doesNotMatch(source, /Przerwij/);
  assert.doesNotMatch(source, /onCancel/);
});

test('Task 05: AgentSessionHeader does NOT include removed controls (mode switcher, delete, dead UI, metadata subtitle)', () => {
  const headerSource = readAgentSessionHeaderSource();

  // Mode switcher must not be present in the header
  assert.doesNotMatch(headerSource, /onModeChange/);
  assert.doesNotMatch(headerSource, /AgentExecutionMode/);
  assert.doesNotMatch(headerSource, /Tryb/);

  // Delete button must not be present in the header (moved to Session details)
  assert.doesNotMatch(headerSource, /handleDeleteSession/);
  assert.doesNotMatch(headerSource, /Trash2/);
  assert.doesNotMatch(headerSource, /Usuń sesję/);

  // No dead model/usage UI
  assert.doesNotMatch(headerSource, /tokens/i);
  assert.doesNotMatch(headerSource, /usage/i);
  assert.doesNotMatch(headerSource, /modelSelector/i);

  // No multiline metadata subtitle in AgentSessionHeader
  assert.doesNotMatch(headerSource, /cała specyfikacja/);
});

test('Task 05: AgentSessionPage delegates header rendering to AgentSessionHeader and controls AgentSessionDetails Sheet', () => {
  const agentSessionPageSource = readAgentSessionPageSource();

  // Imports and renders AgentSessionHeader
  assert.match(agentSessionPageSource, /import \{ AgentSessionHeader \} from '\.\//);
  assert.match(agentSessionPageSource, /<AgentSessionHeader/);

  // Details sheet trigger opens AgentSessionDetails
  assert.match(agentSessionPageSource, /onOpenDetails=\{/);
  assert.match(agentSessionPageSource, /<AgentSessionDetails/);
  assert.match(agentSessionPageSource, /<Sheet open=\{isSessionDetailsOpen\}/);

  // Header in AgentSessionPage has no inline Trash or mode switcher
  assert.doesNotMatch(agentSessionPageSource, /Trash2/);
});
