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

test('Item 2A & 2B (Task 07 / Item 9A): AiSessionRow uses non-interactive card, semantic sibling buttons, and interactive task chips', () => {
  const sessionListSource = readSource('components/ai-session-list.tsx');

  // Outer container is a non-interactive div without role=button or tabIndex=0
  assert.ok(!sessionListSource.includes('role="button"'), 'Outer card must not be role=button');

  // Primary open session link/button exists as its own control
  assert.ok(sessionListSource.includes('onOpen(session)'));

  // Task links are styled as interactive chips with CheckSquare icon and hover/focus states
  assert.ok(sessionListSource.includes('onOpenTask && matchedTask ? ('));
  assert.ok(sessionListSource.includes('<CheckSquare'));
  assert.ok(sessionListSource.includes('cursor-pointer'));
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

test('Item 2C, 2D & Item 9B/9C: Reusable TaskDialog component is mounted from both SpecDetail and AiChatPage without leaveChat()', () => {
  const taskDialogSource = readSource('components/task-dialog.tsx');
  const specDetailSource = readSource('components/spec-detail.tsx');
  const aiChatSource = readSource('components/ai-chat.tsx');

  // TaskDialog is a reusable component in components/task-dialog.tsx
  assert.ok(taskDialogSource.includes('export function TaskDialog('));
  assert.ok(taskDialogSource.includes('export interface TaskDialogProps'));
  assert.ok(taskDialogSource.includes('useSpecificationDocument('));
  assert.ok(taskDialogSource.includes('useSpecificationActions('));
  assert.ok(taskDialogSource.includes('useAiSessions('));

  // SpecDetail imports and mounts TaskDialog
  assert.ok(specDetailSource.includes("import { TaskDialog } from '@/components/task-dialog';"));
  assert.ok(specDetailSource.includes('<TaskDialog'));
  assert.ok(specDetailSource.includes('taskId={selectedTask.id}'));

  // AiChatPage imports and mounts TaskDialog locally as an overlay without calling leaveChat()
  assert.ok(aiChatSource.includes("import { TaskDialog } from '@/components/task-dialog';"));
  assert.ok(aiChatSource.includes('const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);'));
  assert.ok(aiChatSource.includes('setInspectedTaskId(taskId);'));
  assert.ok(aiChatSource.includes('<TaskDialog'));
  assert.ok(aiChatSource.includes('taskId={inspectedTaskId}'));
  assert.ok(aiChatSource.includes('onClose={() => setInspectedTaskId(null)}'));
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
