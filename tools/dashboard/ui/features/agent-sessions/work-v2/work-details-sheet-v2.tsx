import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Clock, Code2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TOOL_KIND_ICONS_V2 } from './tool-kind-icons-v2';
import type { CanonicalTurnV2, ToolInvocationWorkItemV2, WorkItemV2 } from '../types';
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

/** Full ungrouped Work list — every individual invocation in its exact original order. */
function WorkList({ work, onSelect }: { work: WorkItemV2[]; onSelect: (item: ToolInvocationWorkItemV2) => void }) {
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
                  {item.durationMs != null && <span className="ml-1 text-[10px] text-[var(--muted)]">{item.durationMs}ms</span>}
                </span>
                {started && <span className="shrink-0 text-[10px] text-[var(--muted)]">{started}</span>}
                <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)]" />
              </button>
            </li>
          );
        }
        if (item.type === 'commentary' || item.type === 'reasoning') {
          return (
            <li key={item.id} className="px-2 py-1 text-[var(--muted)]">
              {item.type === 'reasoning' ? 'Thinking' : 'Commentary'} · {item.text || '—'}
            </li>
          );
        }
        return (
          <li key={item.id} className="px-2 py-1 text-[var(--muted)]">
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
  initialToolId?: string | null;
}

/**
 * Level 3 — Work Details (areas/work-ux-presentation.md § "Level 3"). Side drawer on
 * desktop, full/bottom sheet on mobile via the shared Sheet primitive's responsive
 * `side="right"` variant (already full-width under `sm:`, max-w-md above it — the same
 * pattern `AgentSessionDetailsSheet` uses). Never inlines large payloads in Level 2; this
 * is the only surface that does.
 */
export function WorkDetailsSheetV2({ turn, open, onOpenChange, initialToolId = null }: WorkDetailsSheetV2Props) {
  const [selectedToolId, setSelectedToolId] = useState<string | null>(initialToolId);

  const selectedTool = useMemo(() => {
    if (!turn || !selectedToolId) return null;
    return turn.work.find((item): item is ToolInvocationWorkItemV2 => item.type === 'tool' && item.id === selectedToolId) ?? null;
  }, [turn, selectedToolId]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSelectedToolId(null);
        else setSelectedToolId(initialToolId);
      }}
    >
      <SheetContent side="right" className={cn('flex flex-col gap-4 overflow-y-auto')}>
        <SheetHeader>
          <SheetTitle>Work Details</SheetTitle>
          {turn && <p className="text-xs text-[var(--muted)]">{turn.provider}</p>}
        </SheetHeader>
        {!turn ? null : selectedTool ? (
          <ToolDetail item={selectedTool} onBack={() => setSelectedToolId(null)} />
        ) : (
          <WorkList work={turn.work} onSelect={(item) => setSelectedToolId(item.id)} />
        )}
      </SheetContent>
    </Sheet>
  );
}
