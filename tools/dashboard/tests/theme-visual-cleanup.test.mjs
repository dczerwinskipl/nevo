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
  const progress = readSource('components/stage-progress.tsx');
  const labels = readSource('components/status-label.tsx');
  const tools = readSource('components/ai-tool-view.tsx');
  const sessions = readSource('components/ai-session-list.tsx');

  assert.ok(board.includes("implementation: { dot: 'bg-[var(--accent)]'"));
  assert.ok(board.includes("review: { dot: 'bg-[var(--warning)]'"));
  assert.ok(board.includes("done: { dot: 'bg-[var(--success)]'"));
  assert.ok(progress.includes("{ id: 'done', label: 'Gotowe', color: 'bg-[var(--success)]' }"));
  assert.ok(progress.includes("{ id: 'implementation', label: 'Implementacja', color: 'bg-[var(--accent)]' }"));
  assert.ok(progress.includes('className="h-full rounded-full bg-[var(--accent)]'));
  assert.match(labels, /case 'approved':[\s\S]*return 'text-\[var\(--success\)\]'/);
  assert.ok(tools.includes('isFailed && <AlertTriangle className="size-3.5 text-[var(--warning)]"'));
  assert.ok(sessions.includes("session.status === 'waitingForUser' && 'bg-[var(--warning-muted)]'"));
});
