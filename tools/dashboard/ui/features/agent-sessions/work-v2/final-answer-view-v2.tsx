import { LoaderCircle } from 'lucide-react';
import { MarkdownContent } from '@/shared/markdown/markdown-content';
import type { FinalAnswerV2 } from '../types';

export interface FinalAnswerViewV2Props {
  finalAnswer: FinalAnswerV2 | null;
}

/**
 * FinalAnswer renders separately below Work (areas/work-ux-presentation.md § "Completed,
 * failed, cancelled, and interrupted turns"; areas/chat-migration-and-validation.md §
 * "Final answer"). `absent`/`null` renders nothing — cancellation or failure never
 * promotes commentary/partial Work into a fabricated final answer.
 */
export function FinalAnswerViewV2({ finalAnswer }: FinalAnswerViewV2Props) {
  if (!finalAnswer || finalAnswer.status === 'absent') return null;

  return (
    <div className="w-full max-w-full min-w-0 rounded-2xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-fg-primary">
      {finalAnswer.status === 'pending' ? (
        <span className="text-fg-muted italic">Oczekiwanie na odpowiedź końcową…</span>
      ) : (
        <MarkdownContent markdown={finalAnswer.text} className="text-fg-primary" />
      )}
      {finalAnswer.status === 'streaming' && (
        <LoaderCircle
          className="ml-1.5 inline size-3.5 animate-spin align-middle text-accent"
          aria-label="Generowanie w toku"
        />
      )}
    </div>
  );
}
