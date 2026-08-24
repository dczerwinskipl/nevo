import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

test('Item 1 (Task 04): ChatComposer uses canonical AI_MODES metadata with no duplicate MODE_METAS', () => {
  const composerSource = readSource('components/composer/composer.tsx');
  const aiModeMetaSource = readSource('lib/ai-mode-meta.ts');

  // Must import AI_MODES from ai-mode-meta
  assert.ok(composerSource.includes("import { AI_MODES, getModeMeta } from '@/lib/ai-mode-meta';") || composerSource.includes("from '@/lib/ai-mode-meta'"));
  assert.ok(!composerSource.includes('const MODE_METAS:'), 'Local MODE_METAS must be removed from composer.tsx');

  // Must render mode buttons iterating over AI_MODES with descriptions
  assert.ok(composerSource.includes('AI_MODES.map((modeMeta) =>'));
  assert.ok(composerSource.includes('title={`${modeMeta.label} - ${modeMeta.description}`}'));
  assert.ok(composerSource.includes('aria-label={`${modeMeta.label}: ${modeMeta.description}`}'));

  // ai-mode-meta.ts exports canonical modes
  assert.ok(aiModeMetaSource.includes('export const AI_MODES'));
  assert.ok(aiModeMetaSource.includes("id: 'ask'"));
  assert.ok(aiModeMetaSource.includes("id: 'edit'"));
  assert.ok(aiModeMetaSource.includes("id: 'agent'"));
});

test('Item 2A & 2B (Task 07): AiSessionRow uses non-interactive card, semantic sibling buttons, and inert stale tasks', () => {
  const sessionListSource = readSource('components/ai-session-list.tsx');

  // Outer container is a non-interactive div without role=button or tabIndex=0
  assert.ok(!sessionListSource.includes('role="button"'), 'Outer card must not be role=button');

  // Primary open session button exists as its own control
  assert.ok(sessionListSource.includes('onClick={() => onOpen(session)}'));

  // Task links are sibling buttons and stale tasks render as non-clickable span
  assert.ok(sessionListSource.includes('onOpenTask && matchedTask ? ('));
  assert.ok(sessionListSource.includes('<span className="truncate">{label}</span>'));

  // Delete button is a dedicated button
  assert.ok(sessionListSource.includes('title="Usuń sesję z dysku"'));
});

test('Item 2B & 2C (Task 07): SessionDetails and AiChatPage resolve tasks against change and use TaskNavigationTarget', () => {
  const sessionDetailsSource = readSource('components/session-details/session-details.tsx');
  const aiChatSource = readSource('components/ai-chat.tsx');
  const typesSource = readSource('lib/types.ts');

  // TaskNavigationTarget contract exists in types.ts
  assert.ok(typesSource.includes('export interface TaskNavigationTarget {'));
  assert.ok(typesSource.includes('taskId: string;'));

  // SessionDetails supports normalized tasks and inert rendering for stale tasks
  assert.ok(sessionDetailsSource.includes('export interface SessionTaskItem {'));
  assert.ok(sessionDetailsSource.includes('onOpenTask?: (target: TaskNavigationTarget) => void'));
  assert.ok(sessionDetailsSource.includes('onOpenTask?.({ taskId: taskItem.id, specSlug })'));

  // AiChatPage resolves rawTaskIds against change.tasks and passes specSlug
  assert.ok(aiChatSource.includes('const sessionTaskItems = useMemo('));
  assert.ok(aiChatSource.includes('change?.tasks?.find'));
  assert.ok(aiChatSource.includes('specSlug={change?.slug}'));
  assert.ok(aiChatSource.includes('tasks={sessionTaskItems}'));
});

test('Item 2C & 2D (Task 07): App.tsx handleOpenTask and SpecDetail TaskDialog support full task collection and navigation', () => {
  const appSource = readSource('App.tsx');
  const specDetailSource = readSource('components/spec-detail.tsx');

  // App.tsx handles TaskNavigationTarget object or positional params and selects spec by specSlug
  assert.ok(appSource.includes('const handleOpenTask = useCallback((target: TaskNavigationTarget | string'));
  assert.ok(appSource.includes('setSelectedSlug(change.slug);'));
  assert.ok(appSource.includes('setChatOriginTaskId(taskId);'));

  // TaskDialog in spec-detail.tsx receives full tasks collection and onOpenTask handler
  assert.ok(specDetailSource.includes('tasks={tasks.length > 0 ? tasks : [task]}'));
  assert.ok(specDetailSource.includes('tasks={change.tasks}'));
  assert.ok(specDetailSource.includes('setSelectedTaskId(nextTaskId);'));

  // SpecDetail syncs initialTaskId state on navigation
  assert.ok(specDetailSource.includes('setSelectedTaskId(initialTaskId);'));
});

test('Item 4 (Task 12): Compact icon-only connectivity indicator in primary header chrome', () => {
  const appSource = readSource('App.tsx');

  // Indicator is icon-only in header with role=status, tabIndex=0, title, aria-label
  assert.ok(appSource.includes('role="status"'));
  assert.ok(appSource.includes('tabIndex={0}'));
  assert.ok(appSource.includes("aria-label={live ? 'Połączenie na żywo aktywne (SSE: Połączono)' : 'Brak połączenia na żywo (SSE: Rozłączono)'}"));
  assert.ok(appSource.includes("title={live ? 'SSE: Połączono (aktualizacje na żywo aktywne)' : 'SSE: Rozłączono (ponawianie połączenia)'}"));
  assert.ok(appSource.includes('className="flex size-8 items-center justify-center rounded-lg border'));
  assert.ok(!appSource.includes('<span className="hidden sm:inline">{live ? \'SSE: Połączono\' : \'SSE: Rozłączono\'}</span>'), 'Text pill must not remain in header');
});

test('Item 5 (Task 14): Per-task action is placed inline on task title row in StatusBoard', () => {
  const statusBoardSource = readSource('components/status-board.tsx');

  // Title row contains task.title and right-aligned action button
  assert.ok(statusBoardSource.includes('<div className="mt-2.5 flex items-start justify-between gap-2">'));
  assert.ok(statusBoardSource.includes('<h3 className="text-[13px] font-semibold leading-5 text-[var(--foreground)] min-w-0 flex-1">{task.title}</h3>'));
  assert.ok(statusBoardSource.includes('onAction?.(task, actionGate.action);'));
});

test('Item 6: AppSidebar cleanup of unused task/delete handlers', () => {
  const sidebarSource = readSource('components/app-sidebar.tsx');

  assert.ok(!sidebarSource.includes('useDeleteAiSession'), 'useDeleteAiSession must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('handleDeleteSession'), 'handleDeleteSession must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('onOpenTask'), 'onOpenTask must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('activeTasks'), 'activeTasks must be removed from AppSidebar');
});
