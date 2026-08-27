import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

test('neutral foundation tokens do not derive from the interaction accent', () => {
  const css = readSource('index.css');

  assert.match(css, /--background: #090a0d/);
  assert.match(css, /--surface: #0f1116/);
  assert.match(css, /--surface-raised: #14171d/);
  assert.match(css, /--surface-hover: #191d24/);
  assert.match(css, /--border: #252a33/);
  assert.match(css, /--border-strong: #343b47/);
  assert.match(css, /--accent: #3882f6/);

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
  const router = readSource('router.tsx');

  assert.ok(router.includes('backdrop-blur-xl sm:px-7 lg:hidden'));
  assert.ok(router.includes('fixed right-4 top-3 z-40 hidden rounded-xl'));
  assert.ok(router.includes('backdrop-blur-xl lg:flex'));
  assert.ok(router.includes('<ConnectivityControls live={live}'));
});

test('workflow and session states follow the semantic color contract', () => {
  const board = readSource('components/status-board.tsx');
  const lanes = readSource('lib/lane-presentation.ts');
  const progress = readSource('components/stage-progress.tsx');
  const labels = readSource('components/status-label.tsx');
  const tools = readSource('components/ai-tool-view.tsx');
  const sessions = readSource('components/ai-session-list.tsx');

  assert.ok(lanes.includes("implementation: { accent: 'var(--lane-implementation)' }"));
  assert.ok(lanes.includes("review: { accent: 'var(--lane-review)' }"));
  assert.ok(lanes.includes("done: { accent: 'var(--lane-done)' }"));
  assert.ok(board.includes('bg-[var(--lane-accent)]'));
  assert.ok(progress.includes("{ id: 'done', label: 'Gotowe', color: 'bg-[var(--success)]' }"));
  assert.ok(progress.includes("{ id: 'implementation', label: 'Implementacja', color: 'bg-[var(--accent)]' }"));
  assert.ok(progress.includes("style={{ width: `${(count / total) * 100}%` }}"));
  assert.ok(progress.includes("key={stage.id}"));
  assert.match(labels, /case 'approved':[\s\S]*return 'text-\[var\(--success\)\]'/);
  assert.ok(tools.includes('isFailed && <AlertTriangle className="size-3.5 text-[var(--warning)]"'));
  assert.ok(sessions.includes("session.status === 'waitingForUser' && 'bg-[var(--warning-muted)]'"));
});

test('sidebar hierarchy and mode switch stay neutral with a clear primary selection', () => {
  const sidebar = readSource('components/app-sidebar.tsx');

  assert.ok(sidebar.includes('border-r border-[var(--border)] bg-[var(--surface-raised)]'));
  assert.ok(sidebar.includes('rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1'));
  assert.doesNotMatch(sidebar, /shadow-\[inset_0_-2px_0_var\(--accent\)\]/);
  assert.ok(sidebar.includes('className="border-b border-[var(--border)] py-4"'));
  assert.ok(sidebar.includes('divide-y divide-[var(--border)]'));
  assert.ok(sidebar.includes("aria-current={mode === 'active' ? 'page' : undefined}"));
  assert.ok(sidebar.includes("aria-current={mode === 'archive' ? 'page' : undefined}"));

  const modeSwitch = sidebar.slice(
    sidebar.indexOf('mt-4 grid grid-cols-2'),
    sidebar.indexOf('<label className="relative mt-3 block">'),
  );
  assert.doesNotMatch(modeSwitch, /onClick=\{onClose\}/);
});

test('overview avoids duplicate metric cards and board lanes use neutral surfaces', () => {
  const overview = readSource('components/spec-detail/overview-panel.tsx');
  const board = readSource('components/status-board.tsx');

  assert.doesNotMatch(overview, /function MetricCard|aria-label="Podsumowanie specyfikacji"/);
  assert.ok(board.includes('border border-[var(--border)] bg-[var(--surface)]'));
  assert.ok(board.includes("lane.tasks.length === 0 && 'hidden sm:block'"));
  assert.doesNotMatch(board, /border-dashed|tone\.tint|tone\.line/);
  assert.ok(board.includes('<StatusLabel kind="task" status={task.status} className="truncate text-[9px]'));
  assert.doesNotMatch(board, /import \{ Badge \}/);
});
