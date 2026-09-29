import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { MarkdownContent } from '@/shared/markdown/markdown-content';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { cn } from '@/shared/lib/utils';
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

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!finalAnswer?.text) return;
    const ok = await copyToClipboard(finalAnswer.text);
    if (ok) {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  }, [finalAnswer?.text]);

  const hasText = Boolean(finalAnswer.text && finalAnswer.text.trim().length > 0);

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
      {hasText && (
        <div className="mt-2.5 flex items-center justify-end border-t border-border/40 pt-1.5">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? 'Skopiowano odpowiedź' : 'Kopiuj odpowiedź'}
            title={copied ? 'Skopiowano' : 'Kopiuj odpowiedź'}
            className={cn(
              'inline-flex min-h-[30px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors select-none cursor-pointer',
              'text-fg-muted hover:bg-surface-hover hover:text-fg-primary active:scale-95',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              copied && 'text-status-success hover:text-status-success',
            )}
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-status-success" />
                <span>Skopiowano</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Kopiuj</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
