import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReasoningViewProps {
  reasoning: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export function ReasoningView({ reasoning, isStreaming = false, defaultExpanded = false }: ReasoningViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || isStreaming);

  if (!reasoning && !isStreaming) return null;

  return (
    <div className="my-2 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_50%,transparent)] text-xs">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <span className="flex items-center gap-2">
          <Brain className={cn('size-3.5 text-[var(--accent)]', isStreaming && 'animate-pulse')} />
          <span>{isStreaming ? 'Myślenie w toku…' : 'Przebieg rozumowania'}</span>
          {isStreaming && <Sparkles className="size-3 animate-spin text-[var(--accent)]" />}
        </span>
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--muted-strong)]">
          {reasoning || <span className="text-[var(--muted)] italic">Analizowanie kontekstu…</span>}
        </div>
      )}
    </div>
  );
}
