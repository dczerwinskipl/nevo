import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../ui/' + relative, import.meta.url)), 'utf8');
}

test('neutral foundation tokens do not derive from the interaction accent', () => {
  const css = readSource('index.css');

  assert.match(css, /--color-background: #090a0d/);
  assert.match(css, /--color-surface: #0f1116/);
  assert.match(css, /--color-surface-raised: #14171d/);
  assert.match(css, /--color-surface-hover: #191d24/);
  assert.match(css, /--color-border: #252a33/);
  assert.match(css, /--color-border-strong: #343b47/);
  assert.match(css, /--color-accent: #3882f6/);

  assert.match(css, /--background:\s*var\(--color-background\);/);
  assert.match(css, /--surface:\s*var\(--color-surface\);/);
  assert.match(css, /--border:\s*var\(--color-border\);/);
  assert.match(css, /--accent:\s*var\(--color-accent\);/);

  const bodyRule = css.slice(css.indexOf('body {'), css.indexOf('body::before'));
  assert.doesNotMatch(bodyRule, /var\(--accent\)|59, 130, 246/);
});

test('theme exposes interaction and semantic token families', () => {
  const css = readSource('index.css');

  for (const token of [
    '--accent-muted',
    '--accent-border',
    '--success-muted',
    '--success-border',
    '--warning-muted',
    '--warning-border',
    '--danger-muted',
    '--danger-border',
    '--lane-new',
    '--lane-design',
    '--lane-ready',
    '--lane-implementation',
    '--lane-review',
    '--lane-done',
  ]) {
    assert.ok(css.includes(token), `missing ${token}`);
  }
});

test('desktop shell removes the full-width brand header and keeps floating utilities', () => {
  const appLayout = readSource('screens/specification-console-layout.tsx');

  assert.ok(appLayout.includes('backdrop-blur-xl sm:px-7 lg:hidden'));
  assert.ok(appLayout.includes('fixed top-3 right-4 z-40 hidden rounded-xl'));
  assert.ok(appLayout.includes('backdrop-blur-xl lg:flex'));
  assert.match(appLayout, /<SpecificationLiveControls\s+live=\{live\}|<ConnectivityControls\s+live=\{live\}/);
});

test('workflow and session states follow the semantic color contract', () => {
  const board = readSource('features/specifications/detail/status-board.tsx');
  const lanes = readSource('features/specifications/detail/lane-presentation.ts');
  const progress = readSource('features/specifications/stage-progress.tsx');
  const labels = readSource('shared/ui/status-label.tsx');
  const tools = readSource('features/agent-sessions/turn-work/tool-call-view.tsx');
  const sessions = readSource('features/agent-sessions/agent-session-list.tsx');

  assert.ok(lanes.includes("implementation: { dotClassName: 'bg-status-active' }"));
  assert.ok(lanes.includes("review: { dotClassName: 'bg-status-warning' }"));
  assert.ok(lanes.includes("done: { dotClassName: 'bg-status-success' }"));
  assert.ok(board.includes('presentation.dotClassName'));
  assert.ok(progress.includes("{ id: 'done', label: 'Gotowe', color: 'bg-status-success' }"));
  assert.ok(progress.includes("{ id: 'implementation', label: 'Implementacja', color: 'bg-status-active' }"));
  assert.ok(progress.includes('style={{ width: `${(count / total) * 100}%` }}'));
  assert.ok(progress.includes('key={stage.id}'));
  const specStatus = readSource('features/specifications/status.ts');
  assert.match(specStatus, /case 'approved':[\s\S]*return 'success'/);
  assert.ok(tools.includes('isFailed && <AlertTriangle className="size-3.5 text-status-warning"'));
  assert.ok(sessions.includes("session.status === 'waitingForUser' && 'bg-status-warning/10'"));
});

test('sidebar hierarchy and mode switch stay neutral with a clear primary selection', () => {
  const sidebar = readSource('features/specifications/navigation/specification-sidebar.tsx');

  assert.ok(sidebar.includes('border-r border-border bg-surface-raised'));
  assert.ok(sidebar.includes('rounded-xl border border-border bg-surface p-1'));
  assert.doesNotMatch(sidebar, /shadow-\[inset_0_-2px_0_var\(--accent\)\]/);
  assert.ok(sidebar.includes('className="border-b border-border py-4"'));
  assert.ok(sidebar.includes('divide-y divide-border'));
  assert.ok(sidebar.includes("aria-current={mode === 'active' ? 'page' : undefined}"));
  assert.ok(sidebar.includes("aria-current={mode === 'archive' ? 'page' : undefined}"));

  const modeSwitch = sidebar.slice(
    sidebar.indexOf('mt-4 grid grid-cols-2'),
    sidebar.indexOf('<label className="relative mt-3 block">'),
  );
  assert.doesNotMatch(modeSwitch, /onClick=\{onClose\}/);
});

test('overview avoids duplicate metric cards and board lanes use neutral surfaces', () => {
  const overview = readSource('screens/specification-detail/specification-overview.tsx');
  const board = readSource('features/specifications/detail/status-board.tsx');

  assert.doesNotMatch(overview, /function MetricCard|aria-label="Podsumowanie specyfikacji"/);
  assert.ok(board.includes('border border-border bg-surface'));
  assert.ok(board.includes("lane.tasks.length === 0 && 'hidden sm:block'"));
  assert.doesNotMatch(board, /border-dashed|tone\.tint|tone\.line/);
  assert.match(board, /<StatusLabel\s+tone=\{taskStatusTone\(task\.status\)\}\s+className="truncate text-\[9px\]/);
  assert.doesNotMatch(board, /import \{ Badge \}/);
});
