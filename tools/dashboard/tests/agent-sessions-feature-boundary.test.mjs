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
    assert.equal(existsSync(uiPath(dir)), false, `${dir} must no longer exist — content moved to features/agent-sessions/`);
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

test('the agent-sessions feature owns its canonical top-level files', () => {
  for (const file of [
    'features/agent-sessions/agent-session-page.tsx',
    'features/agent-sessions/agent-session-header.tsx',
    'features/agent-sessions/agent-session-details.tsx',
    'features/agent-sessions/agent-session-list.tsx',
    'features/agent-sessions/agent-session-route.tsx',
    'features/agent-sessions/create-agent-session-dialog.tsx',
    'features/agent-sessions/queries.ts',
    'features/agent-sessions/types.ts',
    'features/agent-sessions/mode-meta.ts',
    'features/agent-sessions/provider-config.ts',
    'features/agent-sessions/create-agent-session-helpers.ts',
  ]) {
    assert.equal(existsSync(uiPath(file)), true, `${file} must exist`);
  }
});

test('the agent-sessions feature does not reintroduce horizontal buckets', () => {
  for (const bucket of [
    'features/agent-sessions/components',
    'features/agent-sessions/hooks',
    'features/agent-sessions/utils',
    'features/agent-sessions/helpers',
    'features/agent-sessions/services',
  ]) {
    assert.equal(existsSync(uiPath(bucket)), false, `${bucket} must not exist — no horizontal buckets inside the feature`);
  }
});

test('the agent-sessions feature organizes runtime/transcript/composer/interactions/turn-work subfolders', () => {
  for (const file of [
    'features/agent-sessions/runtime/agent-session-runtime.ts',
    'features/agent-sessions/runtime/assistant-ui-bridge.ts',
    'features/agent-sessions/runtime/agent-event-reducer.ts',
    'features/agent-sessions/runtime/agent-event-source.ts',
    'features/agent-sessions/runtime/agent-session-transport.ts',
    'features/agent-sessions/runtime/agent-turn-transport.ts',
    'features/agent-sessions/runtime/pending-dispatch-store.ts',
    'features/agent-sessions/runtime/use-initial-dispatch.ts',
    'features/agent-sessions/transcript/transcript-message.tsx',
    'features/agent-sessions/transcript/message-collapse.ts',
    'features/agent-sessions/transcript/projection.ts',
    'features/agent-sessions/transcript/use-scroll-follow.ts',
    'features/agent-sessions/transcript/use-visual-viewport.ts',
    'features/agent-sessions/composer/agent-session-composer.tsx',
    'features/agent-sessions/composer/composer-sizing.ts',
    'features/agent-sessions/interactions/interaction-prompt.tsx',
    'features/agent-sessions/turn-work/turn-work-summary.tsx',
    'features/agent-sessions/turn-work/turn-work-visibility.ts',
    'features/agent-sessions/turn-work/tool-activity-labels.ts',
    'features/agent-sessions/turn-work/tool-call-view.tsx',
  ]) {
    assert.equal(existsSync(uiPath(file)), true, `${file} must exist`);
  }
});
