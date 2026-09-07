import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function uiPath(relative) {
  return fileURLToPath(new URL('../ui/' + relative, import.meta.url));
}

test('old fragmented Agent Session directories no longer exist under ui/components', () => {
  for (const dir of [
    'components/ai-chat',
    'components/chat-header',
    'components/composer',
    'components/conversation',
    'components/session-details',
    'components/work',
  ]) {
    assert.equal(
      existsSync(uiPath(dir)),
      false,
      `${dir} must no longer exist — content moved to features/agent-sessions/`,
    );
  }
});

test('old standalone Agent Session files no longer exist under ui/components or ui/lib', () => {
  for (const file of [
    'components/ai-session-list.tsx',
    'components/ai-session-create-modal.tsx',
    'components/ai-interaction-prompt.tsx',
    'components/ai-reasoning-view.tsx',
    'components/ai-tool-view.tsx',
    'lib/ai-mode-meta.ts',
    'lib/ai-provider-config.ts',
  ]) {
    assert.equal(existsSync(uiPath(file)), false, `${file} must no longer exist — moved to features/agent-sessions/`);
  }
});

test('no old-path forwarding/compat barrels remain for the removed directories', () => {
  for (const barrel of [
    'components/ai-chat/index.tsx',
    'components/chat-header/index.ts',
    'components/composer/index.ts',
    'components/session-details/index.ts',
  ]) {
    assert.equal(existsSync(uiPath(barrel)), false, `${barrel} must not exist as a forwarding barrel`);
  }
});

test('the agent-sessions feature directory exists as one coherent ownership boundary', () => {
  assert.equal(existsSync(uiPath('features/agent-sessions')), true, 'features/agent-sessions must exist');
});

test('the agent-sessions feature does not reintroduce horizontal buckets', () => {
  for (const bucket of [
    'features/agent-sessions/components',
    'features/agent-sessions/hooks',
    'features/agent-sessions/utils',
    'features/agent-sessions/helpers',
    'features/agent-sessions/services',
  ]) {
    assert.equal(
      existsSync(uiPath(bucket)),
      false,
      `${bucket} must not exist — no horizontal buckets inside the feature`,
    );
  }
});
