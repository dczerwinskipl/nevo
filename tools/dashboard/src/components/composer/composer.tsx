import { useState, useRef, useCallback, useEffect, useLayoutEffect, type KeyboardEvent } from 'react';
import { Send, CircleStop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgentExecutionMode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getComposerLayoutState } from './composer-sizing';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface ChatComposerProps {
  onSend: (text: string) => void | Promise<void>;
  onCancel?: () => void;
  isRunning?: boolean;
  canCancel?: boolean;
  isProviderAvailable?: boolean;
  disabled?: boolean;
  loadError?: unknown;
  currentMode: AgentExecutionMode;
  onModeChange: (mode: AgentExecutionMode) => void;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const MODE_METAS: Record<AgentExecutionMode, { label: string; description: string }> = {
  ask: {
    label: 'ask',
    description: 'Tryb Ask (Plan) - tylko odczyt i analiza bez modyfikacji plików',
  },
  edit: {
    label: 'edit',
    description: 'Tryb Edit (Domyślny) - bezpieczna edycja kodu w workspace',
  },
  agent: {
    label: 'agent',
    description: 'Tryb Agent (Auto) - pełna autonomia z pominięciem pytań o uprawnienia',
  },
};

export function ChatComposer({
  onSend,
  onCancel,
  isRunning = false,
  canCancel = true,
  isProviderAvailable = true,
  disabled = false,
  loadError,
  currentMode,
  onModeChange,
  placeholder,
  textareaRef: externalTextareaRef,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    if (!isFocused) {
      el.style.height = '';
      return;
    }

    // Reset height temporarily to correctly compute scrollHeight when deleting or pasting text
    el.style.height = 'auto';
    const newHeight = el.scrollHeight;
    el.style.height = `${newHeight}px`;
  }, [isFocused, textareaRef]);

  useIsomorphicLayoutEffect(() => {
    adjustHeight();
  }, [draft, isFocused, adjustHeight]);

  const isDisabled = disabled || !isProviderAvailable || Boolean(loadError);

  const defaultPlaceholder = loadError
    ? ('kind' in (loadError as any) && (loadError as any).kind === 'not_found'
        ? 'Sesja nie została znaleziona...'
        : 'Serwer dashboardu jest niedostępny...')
    : !isProviderAvailable
    ? 'Provider CLI niedostępny (brak w PATH)'
    : disabled
    ? 'Ta sesja jest tylko do odczytu'
    : isRunning
    ? 'Turn trwa…'
    : 'Napisz wiadomość…';

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter inserts newline (FR-21). Never submit on Enter.
    // Explicit send button only.
  };

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || isRunning || isDisabled) return;
    setDraft('');
    onSend(trimmed);
  };

  const layoutState = getComposerLayoutState({ isFocused, draft });

  return (
    <div
      className={cn(
        'relative rounded-2xl border bg-[var(--surface)] transition-all duration-200 ease-out',
        isFocused
          ? 'border-[var(--accent)] ring-1 ring-[var(--accent)] shadow-lg'
          : 'border-[var(--border)] hover:border-[var(--border-strong)]'
      )}
    >
      <div className="flex flex-col">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Wiadomość</span>
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onInput={adjustHeight}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            disabled={isDisabled}
            placeholder={placeholder || defaultPlaceholder}
            className={cn(
              'w-full resize-none bg-transparent px-4 pt-3 pb-2 text-base sm:text-sm outline-none placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60 transition-all duration-150',
              layoutState.className
            )}
          />
        </label>

        {/* Footer controls: Mode switcher on left, Send/Cancel on right */}
        <div className="flex items-center justify-between border-t border-[var(--border)]/60 px-3 py-2">
          {/* Mode Switcher */}
          <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-0.5 text-[10px]">
            {(['ask', 'edit', 'agent'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={cn(
                  'rounded px-2 py-1 font-semibold uppercase tracking-wider text-[9px] transition-colors',
                  currentMode === m
                    ? 'bg-[var(--accent)] text-[#111604]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                )}
                title={MODE_METAS[m].description}
                disabled={isDisabled}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Action button: Send or Stop */}
          <div>
            {isRunning ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onCancel}
                disabled={!canCancel}
                className="h-8 gap-1.5 px-3 text-xs font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300"
                aria-label="Przerwij generowanie"
              >
                <CircleStop className="size-3.5" />
                <span>Przerwij</span>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleSend}
                disabled={!draft.trim() || isDisabled}
                className="h-8 gap-1.5 px-3.5 text-xs font-semibold"
                aria-label="Wyślij wiadomość"
              >
                <span>Wyślij</span>
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
