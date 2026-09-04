import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  LoaderCircle,
  Wrench,
} from 'lucide-react';
import { activityLabelFor } from './tool-activity-labels';
import type { AgentToolCall } from '../types';

export interface ToolCallViewProps {
  toolCall: AgentToolCall;
}

export function ToolCallView({ toolCall }: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(false);

  const isRunning = toolCall.status === 'running';
  const isFailed = toolCall.status === 'failed';
  const isCompleted = toolCall.status === 'completed';
  const { label: activityLabel } = activityLabelFor(toolCall.name, toolCall.input);

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
    <div className="my-2 w-full max-w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] text-xs shadow-xs">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full max-w-full min-w-0 items-center justify-between px-3 py-2 text-left font-medium hover:bg-white/4"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="size-3.5 shrink-0 text-[var(--accent)]" />
          {/* Activity label is primary; status is a small secondary icon only — reverse
              of the previous uppercase status-badge-as-primary treatment. */}
          <span className="truncate font-medium text-[var(--foreground)]">{activityLabel}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-[var(--muted)]">
          {isRunning && <LoaderCircle className="size-3.5 animate-spin text-[var(--accent)]" />}
          {isCompleted && <CheckCircle2 className="size-3.5 text-[var(--success)]" />}
          {isFailed && <AlertTriangle className="size-3.5 text-[var(--warning)]" />}
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
        <div className="max-w-full min-w-0 space-y-2 border-t border-[var(--border)] px-3 py-2">
          <div className="max-w-full min-w-0">
            <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
              <Wrench className="size-3" /> Tool
            </p>
            <p className="mt-1 font-mono text-[10px] break-words text-[var(--muted-strong)]">{toolCall.name}</p>
          </div>

          {toolCall.input != null && (
            <div className="max-w-full min-w-0">
              <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
                <Code2 className="size-3" /> Wejście
              </p>
              <pre className="mt-1 max-h-48 max-w-full overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-2 font-mono text-[10px] leading-relaxed whitespace-pre text-[var(--foreground)]">
                {formatPayload(toolCall.input)}
              </pre>
            </div>
          )}

          {toolCall.output != null && (
            <div className="max-w-full min-w-0">
              <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
                <Code2 className="size-3" /> Wynik
              </p>
              <pre className="mt-1 max-h-48 max-w-full overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-2 font-mono text-[10px] leading-relaxed whitespace-pre text-[var(--foreground)]">
                {formatPayload(toolCall.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
