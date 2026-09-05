import { useMemo, useState, useCallback } from 'react';
import { AlertTriangle, ArrowLeft, Ban, Check, ChevronRight, Clock, Code2, LoaderCircle, X } from 'lucide-react';
import { Sheet, SheetContent } from '@/shared/ui/sheet';
import { MarkdownContent } from '@/shared/markdown/markdown-content';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { previewPlainText } from './text-preview-v2';
import type {
  CanonicalTurnV2,
  CommentaryWorkItemV2,
  ReasoningWorkItemV2,
  ToolInvocationWorkItemV2,
  WorkItemV2,
} from '../types';
import { cn } from '@/shared/lib/utils';

function formatPayload(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatAbsolute(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function formatDuration(durationMs?: number): string | null {
  if (durationMs == null) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function resolveToolSubject(item: ToolInvocationWorkItemV2): string | null {
  if (item.description?.trim()) return item.description.trim();
  if (item.actions && item.actions.length > 0) {
    const target = item.actions.find((a) => a.target)?.target;
    if (target?.trim()) return target.trim();
  }
  if (item.input && typeof item.input === 'object') {
    const inp = item.input as Record<string, unknown>;
    for (const key of ['path', 'file', 'target', 'command', 'query', 'url']) {
      if (typeof inp[key] === 'string' && (inp[key] as string).trim()) {
        return (inp[key] as string).trim();
      }
    }
  }
  return null;
}

/** Full technical inspection of one ToolInvocation — every field the canonical model exposes. */
function ToolDetail({ item }: { item: ToolInvocationWorkItemV2 }) {
  const Icon = TOOL_KIND_ICONS_V2[item.kind];
  const started = formatAbsolute(item.startedAt);
  const completed = formatAbsolute(item.completedAt);
  const duration = formatDuration(item.durationMs);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-accent" />
        <span className="font-semibold text-fg-primary">{item.title}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-fg-muted">Narzędzie</dt>
        <dd className="font-mono text-fg-secondary">{item.toolName}</dd>
        <dt className="text-fg-muted">Rodzaj</dt>
        <dd className="text-fg-secondary">{item.kind}</dd>
        <dt className="text-fg-muted">Status</dt>
        <dd className="text-fg-secondary">{item.status}</dd>
        {started && (
          <>
            <dt className="text-fg-muted">Rozpoczęto</dt>
            <dd className="text-fg-secondary">{started}</dd>
          </>
        )}
        {completed && (
          <>
            <dt className="text-fg-muted">Zakończono</dt>
            <dd className="text-fg-secondary">{completed}</dd>
          </>
        )}
        {duration && (
          <>
            <dt className="flex items-center gap-1 text-fg-muted">
              <Clock className="size-3" /> Czas trwania
            </dt>
            <dd className="text-fg-secondary">{duration}</dd>
          </>
        )}
        {item.exitCode != null && (
          <>
            <dt className="text-fg-muted">Kod wyjścia</dt>
            <dd className="font-mono text-fg-secondary">{item.exitCode}</dd>
          </>
        )}
        {item.closureReason && (
          <>
            <dt className="text-fg-muted">Powód zamknięcia</dt>
            <dd className="text-fg-secondary">{item.closureReason}</dd>
          </>
        )}
      </dl>

      {item.description && <p className="text-fg-secondary">{item.description}</p>}

      {Boolean(item.actions && item.actions.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">ToolActions</p>
          <ol className="mt-1 space-y-1">
            {item.actions.map((action) => (
              <li key={action.id} className="rounded border border-border px-2 py-1">
                <span className="font-medium text-fg-primary">{action.title}</span>
                {action.target && <span className="text-fg-muted"> · {action.target}</span>}
                {action.status && <span className="ml-1 text-[10px] text-fg-muted">({action.status})</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {item.input != null && (
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
            <Code2 className="size-3" /> Wejście
          </p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-background p-2 font-mono text-[10px] leading-relaxed whitespace-pre text-fg-primary">
            {formatPayload(item.input)}
          </pre>
        </div>
      )}

      {item.output != null && (
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
            <Code2 className="size-3" /> Wynik
          </p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-background p-2 font-mono text-[10px] leading-relaxed whitespace-pre text-fg-primary">
            {formatPayload(item.output)}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Full Markdown inspection of one Commentary/Reasoning item — the counterpart to
 * Level 2's single-line plain-text preview (text-preview-v2.ts). This is the only
 * surface allowed to render full Markdown for these items (headings, code, lists).
 */
function TextDetail({ item }: { item: CommentaryWorkItemV2 | ReasoningWorkItemV2 }) {
  const isReasoning = item.type === 'reasoning';
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-fg-primary">{isReasoning ? 'Thinking' : 'Commentary'}</span>
      </div>
      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <MarkdownContent markdown={item.text} className="text-fg-primary" />
      </div>
    </div>
  );
}

/** Full ungrouped Work list — every individual item in its exact original order, as an inspection timeline. */
function WorkList({ work, onSelect }: { work: WorkItemV2[]; onSelect: (item: WorkItemV2) => void }) {
  return (
    <div className="relative w-full max-w-full min-w-0 pl-1">
      {/* Central vertical rail aligned through the marker column */}
      <div className="absolute top-3 bottom-3 left-[18px] w-px -translate-x-1/2 bg-border" aria-hidden="true" />
      <ol className="relative flex flex-col gap-0.5 text-xs">
        {work.map((item) => {
          if (item.type === 'tool') {
            const Icon = TOOL_KIND_ICONS_V2[item.kind] || TOOL_KIND_ICONS_V2.other;
            const duration = formatDuration(item.durationMs);
            const subject = resolveToolSubject(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="group flex w-full gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-fg-primary/4"
                >
                  <div className="relative flex size-4 shrink-0 items-center justify-center">
                    <span className="relative z-10 flex items-center justify-center bg-transparent">
                      <Icon className="size-3.5 text-fg-muted group-hover:text-fg-muted" />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-fg-primary">{item.title}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        {item.status === 'completed' ? (
                          <Check className="size-3 text-fg-secondary" aria-label="Zakończono pomyślnie" />
                        ) : item.status === 'failed' ? (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-status-error">
                            <AlertTriangle className="size-3 text-status-error" />
                            Błąd
                          </span>
                        ) : item.status === 'cancelled' || item.status === 'interrupted' ? (
                          <span className="flex items-center gap-1 text-[10px] text-fg-muted">
                            <Ban className="size-3" />
                            Przerwano
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-accent">
                            <LoaderCircle className="size-3 animate-spin" />
                            Aktywne
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-between gap-2 text-[11px] text-fg-muted">
                      <span className="truncate font-mono text-[11px] text-fg-secondary">
                        {subject || <span className="font-sans text-fg-muted">—</span>}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {duration && <span>{duration}</span>}
                        <ChevronRight className="size-3 text-fg-muted transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          }
          if (item.type === 'commentary' || item.type === 'reasoning') {
            const isReasoning = item.type === 'reasoning';
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="group flex w-full gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-fg-primary/4"
                >
                  <div className="relative flex size-4 shrink-0 items-center justify-center">
                    {isReasoning ? (
                      <span className="relative z-10 size-1.5 rounded-full border border-fg-secondary bg-transparent" />
                    ) : (
                      <span className="relative z-10 size-1.5 rounded-full bg-fg-muted" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-[10px] font-medium tracking-wider text-fg-muted uppercase">
                        {isReasoning ? 'Thinking' : 'Commentary'}
                      </span>
                      <ChevronRight className="size-3 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <div
                      className={cn(
                        'text-[11px] leading-relaxed',
                        isReasoning ? 'text-fg-secondary italic' : 'text-fg-muted',
                      )}
                    >
                      <span className="line-clamp-2">{previewPlainText(item.text, 120) || '—'}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          }
          return (
            <li key={item.id}>
              <div className="flex w-full gap-2 px-1.5 py-1 text-xs text-fg-muted">
                <div className="relative flex size-4 shrink-0 items-center justify-center">
                  <span className="relative z-10 size-1.5 rounded-full bg-fg-muted" />
                </div>
                <span>
                  {item.interaction.kind} · {item.status}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
export interface WorkDetailsSheetV2Props {
  turn: CanonicalTurnV2 | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItemId?: string | null;
  onSelectItemId?: (id: string | null) => void;
  initialItemId?: string | null;
}

/**
 * Level 3 — Work Details (areas/work-ux-presentation.md § "Level 3"). Side drawer on
 * desktop, full/bottom sheet on mobile via the shared Sheet primitive's responsive
 * `side="right"` variant (already full-width under `sm:`, max-w-md above it — the same
 * pattern `AgentSessionDetailsSheet` uses). Never inlines large payloads in Level 2; this
 * is the only surface that does, and the only one that renders full Commentary/Reasoning
 * Markdown. Richer per-row metadata than Level 2 on purpose — Level 2 scans, this
 * inspects exactly what happened.
 */
export function WorkDetailsSheetV2({
  turn,
  open,
  onOpenChange,
  selectedItemId: controlledSelectedItemId,
  onSelectItemId,
  initialItemId = null,
}: WorkDetailsSheetV2Props) {
  const [uncontrolledSelectedItemId, setUncontrolledSelectedItemId] = useState<string | null>(initialItemId);

  const isControlled = controlledSelectedItemId !== undefined;
  const currentSelectedItemId = isControlled ? controlledSelectedItemId : uncontrolledSelectedItemId;

  const handleSelectItem = useCallback(
    (id: string | null) => {
      if (isControlled) {
        onSelectItemId?.(id);
      } else {
        setUncontrolledSelectedItemId(id);
      }
    },
    [isControlled, onSelectItemId],
  );

  const selectedItem = useMemo(() => {
    if (!turn || !currentSelectedItemId) return null;
    return turn.work.find((item) => item.id === currentSelectedItemId) ?? null;
  }, [turn, currentSelectedItemId]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          handleSelectItem(null);
        }
      }}
    >
      <SheetContent side="right" hideClose className={cn('flex flex-col gap-0 overflow-hidden p-0')}>
        {/* Pinned header with 0 gap to top */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-raised px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3.5 sm:px-6 sm:pt-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {selectedItem && (
              <button
                type="button"
                onClick={() => handleSelectItem(null)}
                className="shrink-0 rounded-lg p-1.5 text-fg-muted opacity-70 transition-opacity hover:bg-surface-hover hover:text-fg-primary hover:opacity-100 focus:ring-2 focus:ring-accent focus:outline-none"
                aria-label="Wróć do listy"
                title="Wróć do listy"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-fg-primary">
                {selectedItem
                  ? selectedItem.type === 'tool'
                    ? selectedItem.title
                    : selectedItem.type === 'reasoning'
                      ? 'Thinking'
                      : selectedItem.type === 'commentary'
                        ? 'Commentary'
                        : 'Interaction'
                  : 'Work Details'}
              </h2>
              <p className="truncate text-[11px] text-fg-muted">
                {selectedItem
                  ? selectedItem.type === 'tool'
                    ? selectedItem.toolName
                    : selectedItem.type === 'reasoning'
                      ? 'Reasoning inspection'
                      : selectedItem.type === 'commentary'
                        ? 'Narration inspection'
                        : selectedItem.interaction.kind
                  : `${turn?.activityCount || 0} actions in this turn`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="shrink-0 rounded-lg p-1.5 text-fg-muted opacity-70 transition-opacity hover:bg-surface-hover hover:text-fg-primary hover:opacity-100 focus:ring-2 focus:ring-accent focus:outline-none"
            aria-label="Zamknij"
            title="Zamknij"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
          {!turn ? null : selectedItem?.type === 'tool' ? (
            <ToolDetail item={selectedItem} />
          ) : selectedItem?.type === 'commentary' || selectedItem?.type === 'reasoning' ? (
            <TextDetail item={selectedItem} />
          ) : (
            <WorkList work={turn.work} onSelect={(item) => handleSelectItem(item.id)} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
