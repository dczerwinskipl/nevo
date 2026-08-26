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
  const aiChatSource = readSource('components/ai-chat/ai-chat.tsx');
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
  const specDetailSource = readSource('components/spec-detail/spec-detail.tsx');
  const aiChatSource = readSource('components/ai-chat/ai-chat.tsx');

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

test('Item 4 (Task 12): Compact icon-only connectivity indicator uses semantic state', () => {
  const routerSource = readSource('router.tsx');

  // Indicator is icon-only in header with role=status, tabIndex=0, title, aria-label
  assert.ok(routerSource.includes('role="status"'));
  assert.ok(routerSource.includes('tabIndex={0}'));
  assert.ok(routerSource.includes("aria-label={live ? 'Połączenie na żywo aktywne (SSE: Połączono)' : 'Brak połączenia na żywo (SSE: Rozłączono)'}"));
  assert.ok(routerSource.includes("title={live ? 'SSE: Połączono (aktualizacje na żywo aktywne)' : 'SSE: Rozłączono (ponawianie połączenia)'}"));
  assert.ok(routerSource.includes("? 'border-[var(--success-border)] bg-[var(--success-muted)] text-[var(--success)]'"));
  assert.ok(routerSource.includes(": 'border-[var(--warning-border)] bg-[var(--warning-muted)] text-[var(--warning)]'"));
  assert.ok(!routerSource.includes('<span className="hidden sm:inline">{live ? \'SSE: Połączono\' : \'SSE: Rozłączono\'}</span>'), 'Text pill must not remain in header');
});

test('Item 5 (Task 14 AC1 & Finding 2): TaskCard uses non-interactive container, inline title-row action, and sibling keyboard controls', () => {
  const statusBoardSource = readSource('components/status-board.tsx');

  // 1. Outer card is non-interactive div without role=button or tabIndex=0
  assert.ok(!statusBoardSource.includes('role="button"'), 'TaskCard outer div must not have role=button');
  assert.ok(!statusBoardSource.includes('tabIndex={0}'), 'TaskCard outer div must not have tabIndex=0');

  // 2. Title row contains both the task-details button and sibling action button inline
  assert.ok(statusBoardSource.includes('<div className="mt-2.5 flex items-start justify-between gap-2">'));

  // 3. Dedicated semantic button for opening task details (flex-1)
  assert.ok(statusBoardSource.includes('onClick={event => onSelect?.(task, event.currentTarget)}'));
  assert.ok(statusBoardSource.includes('aria-label={`Otwórz szczegóły zadania: ${task.title}`}'));
  assert.ok(statusBoardSource.includes('min-w-0 flex-1 text-left'));

  // 4. Separate right-aligned sibling action button (shrink-0), not nested inside details button
  assert.ok(statusBoardSource.includes('onClick={() => onAction?.(task, actionGate.action)}'));
  assert.ok(statusBoardSource.includes('aria-label={`${actionGate.action === \'approve\' ? \'Zatwierdź zadanie\' : \'Zaakceptuj zadanie\'}: ${task.title}\`}'));
});

test('Item 6: AppSidebar cleanup of unused task/delete handlers', () => {
  const sidebarSource = readSource('components/app-sidebar.tsx');

  assert.ok(!sidebarSource.includes('useDeleteAiSession'), 'useDeleteAiSession must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('handleDeleteSession'), 'handleDeleteSession must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('onOpenTask'), 'onOpenTask must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('activeTasks'), 'activeTasks must be removed from AppSidebar');
});

test('Item 7 (Task 17): AiSessionCreateModal provider group uses semantic fieldset and aria-pressed', () => {
  const modalSource = readSource('components/ai-session-create-modal.tsx');

  // Provider group uses fieldset + legend, not label wrapping multiple buttons
  assert.ok(modalSource.includes('<fieldset className="mt-6">'));
  assert.ok(modalSource.includes('<legend className="text-xs font-semibold text-[var(--foreground)]">\n                Provider\n              </legend>') || modalSource.includes('Provider'));
  assert.ok(!modalSource.includes('<label className="mt-6 block text-xs font-semibold">\n              Provider'));

  // Provider buttons have aria-pressed
  assert.ok(modalSource.includes('aria-pressed={selected}'));

  // Execution mode buttons have aria-pressed
  assert.ok(modalSource.includes('aria-pressed={mode === item.id}'));
});

test('Item 8 (Task 18): Shared status label component and consistent session status labels across all 5 sites', () => {
  const statusLabelSource = readSource('components/status-label.tsx');
  const stageProgressSource = readSource('components/stage-progress.tsx');
  const statusBoardSource = readSource('components/status-board.tsx');
  const sessionListSource = readSource('components/ai-session-list.tsx');
  const chatHeaderSource = readSource('components/chat-header/chat-header.tsx');
  const aiChatSource = readSource('components/ai-chat/ai-chat.tsx');

  // 1. StatusLabel primitive owns common typography contract
  assert.ok(statusLabelSource.includes('export function StatusLabel'), 'StatusLabel component exported');
  assert.ok(statusLabelSource.includes('text-[10px] font-bold uppercase tracking-[0.1em]'), 'Typography contract owned by StatusLabel');
  assert.ok(statusLabelSource.includes('formatSessionStatus'), 'Shared formatSessionStatus exported');

  // 2. Site 1: stage-progress stage labels use StatusLabel
  assert.ok(stageProgressSource.includes("import { StatusLabel } from '@/components/status-label'"), 'stage-progress imports StatusLabel');
  assert.ok(stageProgressSource.includes('<StatusLabel className="truncate">{stage.label}</StatusLabel>'), 'stage-progress renders StatusLabel');

  // 3. Site 2 & 3: status-board lane header and task status labels use StatusLabel
  assert.ok(statusBoardSource.includes("from '@/components/status-label'"), 'status-board imports StatusLabel');
  assert.ok(statusBoardSource.includes('<StatusLabel className="text-[var(--muted)]">{lane.shortLabel}</StatusLabel>'), 'status-board lane header renders StatusLabel');
  assert.ok(statusBoardSource.includes('<StatusLabel kind="task" status={task.status} />'), 'status-board task status renders StatusLabel');

  // 4. Site 4: ai-session-list session status uses StatusLabel
  assert.ok(sessionListSource.includes("from '@/components/status-label'"), 'ai-session-list imports from status-label');
  assert.ok(sessionListSource.includes('<StatusLabel kind="session" status={session.status} />'), 'ai-session-list renders StatusLabel');

  // 5. Site 5: chat header session status uses StatusLabel
  assert.ok(chatHeaderSource.includes("import { StatusLabel } from '@/components/status-label'"), 'chat-header imports StatusLabel');
  assert.ok(chatHeaderSource.includes('<StatusLabel>{status}</StatusLabel>'), 'chat-header renders StatusLabel');
  assert.ok(aiChatSource.includes('formatSessionStatus(assistant.activity)'), 'ai-chat passes formatSessionStatus to header');
});

test('Item 9 (Task 19): Standardize H2 scale on spec-detail to text-xl', () => {
  const specDetailSource = readSource('components/spec-detail/overview-panel.tsx');
  const statusBoardSource = readSource('components/status-board.tsx');

  // Both section h2 headings use text-xl
  assert.ok(specDetailSource.includes('<h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">Ostatnie rozmowy</h2>'));
  assert.ok(statusBoardSource.includes('text-xl font-semibold tracking-tight text-[var(--foreground)]'));
});

test('Item 10 (Task 20): AiSessionCreateModal closes on Escape when not creating', () => {
  const modalSource = readSource('components/ai-session-create-modal.tsx');

  // Escape key handler attached to window
  assert.ok(modalSource.includes("event.key === 'Escape'"));
  assert.ok(modalSource.includes('!createSession.creating'));
  assert.ok(modalSource.includes('onClose()'));
});




