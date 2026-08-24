import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseRoute,
  formatRoute,
  isSameRoute,
} from '../src/lib/router.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

test('Item 10: parseRoute correctly maps URL paths to authoritative AppRoute structures', () => {
  // Dashboard routes
  assert.deepEqual(parseRoute('/'), { type: 'dashboard', mode: 'active' });
  assert.deepEqual(parseRoute('/active'), { type: 'dashboard', mode: 'active' });
  assert.deepEqual(parseRoute('/archive'), { type: 'dashboard', mode: 'archive' });
  assert.deepEqual(parseRoute('/specs/archive'), { type: 'dashboard', mode: 'archive' });

  // Specification detail routes
  assert.deepEqual(
    parseRoute('/specs/active/ux-improvements-version-1'),
    { type: 'spec', source: 'active', slug: 'ux-improvements-version-1' }
  );
  assert.deepEqual(
    parseRoute('/specs/archive/old-architecture-spike'),
    { type: 'spec', source: 'archive', slug: 'old-architecture-spike' }
  );
  assert.deepEqual(
    parseRoute('/specs/ux-improvements-version-1'),
    { type: 'spec', source: 'active', slug: 'ux-improvements-version-1' }
  );

  // AI Chat / session routes
  assert.deepEqual(
    parseRoute('/ai/sessions/claude/session-12345'),
    { type: 'chat', provider: 'claude', sessionId: 'session-12345', turnId: null }
  );
  assert.deepEqual(
    parseRoute('/ai/sessions/claude/session-12345', '?turnId=turn-abc'),
    { type: 'chat', provider: 'claude', sessionId: 'session-12345', turnId: 'turn-abc' }
  );
  assert.deepEqual(
    parseRoute('/ai/sessions/antigravity/thread%2F456'),
    { type: 'chat', provider: 'antigravity', sessionId: 'thread/456', turnId: null }
  );
});

test('Item 10: formatRoute correctly serializes AppRoute to authoritative URL paths', () => {
  assert.equal(formatRoute({ type: 'dashboard', mode: 'active' }), '/');
  assert.equal(formatRoute({ type: 'dashboard', mode: 'archive' }), '/archive');
  assert.equal(
    formatRoute({ type: 'spec', source: 'active', slug: 'ux-improvements-version-1' }),
    '/specs/active/ux-improvements-version-1'
  );
  assert.equal(
    formatRoute({ type: 'spec', source: 'archive', slug: 'old-architecture-spike' }),
    '/specs/archive/old-architecture-spike'
  );
  assert.equal(
    formatRoute({ type: 'chat', provider: 'claude', sessionId: 'session-12345', turnId: null }),
    '/ai/sessions/claude/session-12345'
  );
  assert.equal(
    formatRoute({ type: 'chat', provider: 'claude', sessionId: 'session-12345', turnId: 'turn-abc' }),
    '/ai/sessions/claude/session-12345?turnId=turn-abc'
  );
});

test('Item 10: isSameRoute accurately compares route equality', () => {
  assert.equal(
    isSameRoute({ type: 'dashboard', mode: 'active' }, { type: 'dashboard', mode: 'active' }),
    true
  );
  assert.equal(
    isSameRoute({ type: 'dashboard', mode: 'active' }, { type: 'dashboard', mode: 'archive' }),
    false
  );
  assert.equal(
    isSameRoute(
      { type: 'spec', source: 'active', slug: 's1' },
      { type: 'spec', source: 'active', slug: 's1' }
    ),
    true
  );
  assert.equal(
    isSameRoute(
      { type: 'spec', source: 'active', slug: 's1' },
      { type: 'spec', source: 'archive', slug: 's1' }
    ),
    false
  );
  assert.equal(
    isSameRoute(
      { type: 'chat', provider: 'p1', sessionId: 's1', turnId: null },
      { type: 'chat', provider: 'p1', sessionId: 's1', turnId: null }
    ),
    true
  );
  assert.equal(
    isSameRoute(
      { type: 'chat', provider: 'p1', sessionId: 's1', turnId: 't1' },
      { type: 'chat', provider: 'p1', sessionId: 's1', turnId: null }
    ),
    false
  );
});

test('Item 10: App.tsx uses route-based navigation ownership and popstate listener', () => {
  const appSource = readSource('App.tsx');

  // App uses parseRoute, formatRoute from router.ts
  assert.ok(appSource.includes("from '@/lib/router'"));
  assert.ok(appSource.includes('parseRoute(window.location.pathname'));
  assert.ok(appSource.includes('formatRoute('));

  // Popstate listener updates route from window.location
  assert.ok(appSource.includes("window.addEventListener('popstate'"));

  // Primary destinations use navigate() helper
  assert.ok(appSource.includes('const navigate = useCallback('));
  assert.ok(appSource.includes('window.history.pushState('));
  assert.ok(appSource.includes('window.history.replaceState('));

  // Route drives rendered view
  assert.ok(appSource.includes("if (route.type === 'chat')"));
  assert.ok(appSource.includes("route.type === 'spec' && selected"));
});

test('Item 10: Opening task details from chat or spec is transient UI state and does not navigate routes', () => {
  const aiChatSource = readSource('components/ai-chat.tsx');
  const specDetailSource = readSource('components/spec-detail.tsx');

  // In ai-chat.tsx, inspecting task is local state and mounts TaskDialog overlay without route navigation
  assert.ok(aiChatSource.includes('const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);'));
  assert.ok(aiChatSource.includes('setInspectedTaskId(taskId);'));
  assert.ok(aiChatSource.includes('onClose={() => setInspectedTaskId(null)}'));

  // In spec-detail.tsx, selectedTaskId is local state and mounts TaskDialog overlay without route navigation
  assert.ok(specDetailSource.includes('const [selectedTaskId, setSelectedTaskId] = useState<string | null>'));
  assert.ok(specDetailSource.includes('onClose={closeTask}'));
});
