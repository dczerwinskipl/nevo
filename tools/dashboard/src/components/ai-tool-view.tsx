import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Code2, LoaderCircle, Wrench, XCircle } from 'lucide-react';
import type { AgentToolCall } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface AiToolViewProps {
  toolCall: AgentToolCall;
}

export function AiToolView({ toolCall }: AiToolViewProps) {
  const [expanded, setExpanded] = useState(false);

  const isRunning = toolCall.status === 'running';
  const isFailed = toolCall.status === 'failed';
  const isCompleted = toolCall.status === 'completed';

  const formatPayload = (val: unknown): string => {
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val;
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  };

  return (
    <div className="my-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] text-xs shadow-xs">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-medium hover:bg-white/4"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="size-3.5 shrink-0 text-[var(--accent)]" />
          <span className="font-mono font-semibold text-[var(--foreground)] truncate">{toolCall.name}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
              isRunning && 'bg-[color-mix(in_srgb,var(--info)_10%,transparent)] text-[var(--info)]',
              isCompleted && 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success-strong)]',
              isFailed && 'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger-strong)]'
            )}
          >
            {toolCall.status}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-[var(--muted)]">
          {isRunning && <LoaderCircle className="size-3.5 animate-spin text-[var(--accent)]" />}
          {isCompleted && <CheckCircle2 className="size-3.5 text-[var(--success)]" />}
          {isFailed && <XCircle className="size-3.5 text-[var(--danger)]" />}
          {toolCall.durationMs != null && (
            <span className="flex items-center gap-1 text-[10px]">
              <Clock className="size-3" />
              {toolCall.durationMs}ms
            </span>
          )}
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2 space-y-2">
          {toolCall.input != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
                <Code2 className="size-3" /> Wejście
              </p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-2 font-mono text-[10px] leading-relaxed text-[var(--foreground)]">
                {formatPayload(toolCall.input)}
              </pre>
            </div>
          )}

          {toolCall.output != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
                <Code2 className="size-3" /> Wynik
              </p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-2 font-mono text-[10px] leading-relaxed text-[var(--foreground)]">
                {formatPayload(toolCall.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
