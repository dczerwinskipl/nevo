import { MarkdownContent } from '@/shared/markdown/markdown-content';
import type { FinalAnswer } from '../types';

export interface FinalAnswerViewProps {
  finalAnswer: FinalAnswer | null;
}

/**
 * FinalAnswer renders separately below Work (areas/work-ux-presentation.md § "Completed,
 * failed, cancelled, and interrupted turns"; areas/chat-migration-and-validation.md §
 * "Final answer"). `absent`/`null` renders nothing — no answer content was ever produced,
 * so cancellation or failure never fabricates one. `interrupted` renders the text the
 * provider actually emitted before the turn terminated without reaching authoritative
 * completion — it is neither discarded to `absent` nor promoted to `completed`. While
 * `streaming`, no spinner is rendered here: Work's own current-activity indicator is the
 * single "still working" signal, so this view never duplicates it.
 */
export function FinalAnswerView({ finalAnswer }: FinalAnswerViewProps) {
  if (!finalAnswer || finalAnswer.status === 'absent') return null;

  return (
    <div className="w-full max-w-full min-w-0 rounded-2xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-fg-primary">
      {finalAnswer.status === 'pending' ? (
        <span className="text-fg-muted italic">Oczekiwanie na odpowiedź końcową…</span>
      ) : (
        <MarkdownContent markdown={finalAnswer.text} className="text-fg-primary" />
      )}
      {finalAnswer.status === 'interrupted' && (
        <p className="mt-1.5 text-[11px] font-medium text-fg-muted italic">Przerwano przed dokończeniem</p>
      )}
    </div>
  );
}
