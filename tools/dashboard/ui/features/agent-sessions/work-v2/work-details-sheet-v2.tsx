import { useMemo, useState } from 'react';
import { ArrowLeft, Brain, ChevronRight, Clock, Code2, MessageSquareText } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MarkdownContent } from '@/shared/markdown/markdown-content';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import { previewPlainText } from './text-preview-v2';
import type { CanonicalTurnV2, CommentaryWorkItemV2, ReasoningWorkItemV2, ToolInvocationWorkItemV2, WorkItemV2 } from '../types';
import { cn } from '@/lib/utils';

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

/** Full technical inspection of one ToolInvocation — every field the canonical model exposes. */
function ToolDetail({ item, onBack }: { item: ToolInvocationWorkItemV2; onBack: () => void }) {
  const Icon = TOOL_KIND_ICONS_V2[item.kind];
  const started = formatAbsolute(item.startedAt);
  const completed = formatAbsolute(item.completedAt);

  return (
    <div className="space-y-3 text-xs">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[var(--accent)] hover:underline">
        <ArrowLeft className="size-3.5" /> Wszystkie działania
      </button>

      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-[var(--accent)]" />
        <span className="font-semibold text-[var(--foreground)]">{item.title}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-[var(--muted)]">Narzędzie</dt>
        <dd className="font-mono text-[var(--muted-strong)]">{item.toolName}</dd>
        <dt className="text-[var(--muted)]">Rodzaj</dt>
        <dd className="text-[var(--muted-strong)]">{item.kind}</dd>
        <dt className="text-[var(--muted)]">Status</dt>
        <dd className="text-[var(--muted-strong)]">{item.status}</dd>
        {started && (
          <>
            <dt className="text-[var(--muted)]">Rozpoczęto</dt>
            <dd className="text-[var(--muted-strong)]">{started}</dd>
          </>
        )}
        {completed && (
          <>
            <dt className="text-[var(--muted)]">Zakończono</dt>
            <dd className="text-[var(--muted-strong)]">{completed}</dd>
          </>
        )}
        {item.durationMs != null && (
          <>
            <dt className="flex items-center gap-1 text-[var(--muted)]"><Clock className="size-3" /> Czas trwania</dt>
            <dd className="text-[var(--muted-strong)]">{item.durationMs}ms</dd>
          </>
        )}
        {item.exitCode != null && (
          <>
            <dt className="text-[var(--muted)]">Kod wyjścia</dt>
            <dd className="font-mono text-[var(--muted-strong)]">{item.exitCode}</dd>
          </>
        )}
        {item.closureReason && (
          <>
            <dt className="text-[var(--muted)]">Powód zamknięcia</dt>
            <dd className="text-[var(--muted-strong)]">{item.closureReason}</dd>
          </>
        )}
      </dl>

      {item.description && <p className="text-[var(--muted-strong)]">{item.description}</p>}

      {item.actions.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">ToolActions</p>
          <ol className="mt-1 space-y-1">
            {item.actions.map((action) => (
              <li key={action.id} className="rounded border border-[var(--border)] px-2 py-1">
                <span className="font-medium text-[var(--foreground)]">{action.title}</span>
                {action.target && <span className="text-[var(--muted)]"> · {action.target}</span>}
                {action.status && <span className="ml-1 text-[10px] text-[var(--muted)]">({action.status})</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {item.input != null && (
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Code2 className="size-3" /> Wejście
          </p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-2 font-mono text-[10px] leading-relaxed text-[var(--foreground)] whitespace-pre">
            {formatPayload(item.input)}
          </pre>
        </div>
      )}

      {item.output != null && (
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Code2 className="size-3" /> Wynik
          </p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-2 font-mono text-[10px] leading-relaxed text-[var(--foreground)] whitespace-pre">
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
function TextDetail({ item, onBack }: { item: CommentaryWorkItemV2 | ReasoningWorkItemV2; onBack: () => void }) {
  const isReasoning = item.type === 'reasoning';
  return (
    <div className="space-y-3 text-xs">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[var(--accent)] hover:underline">
        <ArrowLeft className="size-3.5" /> Wszystkie działania
      </button>
      <div className="flex items-center gap-2">
        {isReasoning ? <Brain className="size-4 shrink-0 text-[var(--accent)]" /> : <MessageSquareText className="size-4 shrink-0 text-[var(--accent)]" />}
        <span className="font-semibold text-[var(--foreground)]">{isReasoning ? 'Thinking' : 'Commentary'}</span>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-black/10 p-3">
        <MarkdownContent markdown={item.text} className="text-[var(--foreground)]" />
      </div>
    </div>
  );
}

/** Full ungrouped Work list — every individual item in its exact original order, unaffected by Level 2's presentation-only compaction. */
function WorkList({ work, onSelect }: { work: WorkItemV2[]; onSelect: (item: WorkItemV2) => void }) {
  return (
    <ol className="space-y-1 text-xs">
      {work.map((item) => {
        if (item.type === 'tool') {
          const Icon = TOOL_KIND_ICONS_V2[item.kind];
          const started = formatAbsolute(item.startedAt);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/4"
              >
                <Icon className="size-3.5 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-[var(--foreground)]">{item.title}</span>
                  {item.status && <span className="ml-1.5 text-[10px] text-[var(--muted)]">{item.status}</span>}
                  {item.durationMs != null && <span className="ml-1 text-[10px] text-[var(--muted)]">· {item.durationMs}ms</span>}
                </span>
                {started && <span className="shrink-0 text-[10px] text-[var(--muted)]">{started}</span>}
                <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)]" />
              </button>
            </li>
          );
        }
        if (item.type === 'commentary' || item.type === 'reasoning') {
          const Icon = item.type === 'reasoning' ? Brain : MessageSquareText;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/4"
              >
                <Icon className="size-3.5 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--muted-strong)]">{previewPlainText(item.text, 80) || '—'}</span>
                <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)]" />
              </button>
            </li>
          );
        }
        return (
          <li key={item.id} className="px-2 py-1.5 text-[var(--muted)]">
            {item.interaction.kind} · {item.status}
          </li>
        );
      })}
    </ol>
  );
}

export interface WorkDetailsSheetV2Props {
  turn: CanonicalTurnV2 | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
export function WorkDetailsSheetV2({ turn, open, onOpenChange, initialItemId = null }: WorkDetailsSheetV2Props) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId);

  const selectedItem = useMemo(() => {
    if (!turn || !selectedItemId) return null;
    return turn.work.find((item) => item.id === selectedItemId) ?? null;
  }, [turn, selectedItemId]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSelectedItemId(null);
        else setSelectedItemId(initialItemId);
      }}
    >
      <SheetContent side="right" className={cn('flex flex-col gap-4 overflow-y-auto')}>
        <SheetHeader>
          <SheetTitle>Work Details</SheetTitle>
          {turn && <p className="text-xs text-[var(--muted)]">{turn.provider}</p>}
        </SheetHeader>
        {!turn ? null : selectedItem?.type === 'tool' ? (
          <ToolDetail item={selectedItem} onBack={() => setSelectedItemId(null)} />
        ) : selectedItem?.type === 'commentary' || selectedItem?.type === 'reasoning' ? (
          <TextDetail item={selectedItem} onBack={() => setSelectedItemId(null)} />
        ) : (
          <WorkList work={turn.work} onSelect={(item) => setSelectedItemId(item.id)} />
        )}
      </SheetContent>
    </Sheet>
  );
}
