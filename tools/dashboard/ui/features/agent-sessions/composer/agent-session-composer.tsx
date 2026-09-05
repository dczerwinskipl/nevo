import { useState, useRef, useCallback, useEffect, useLayoutEffect, type KeyboardEvent } from 'react';
import { Send, CircleStop } from 'lucide-react';
import { useMediaQuery } from 'usehooks-ts';
import { Button } from '@/shared/ui/button';
import type { AgentExecutionMode } from '../types';
import { AI_MODES, getModeMeta } from '../mode-meta';
import { cn } from '@/shared/lib/utils';
import {
  getComposerLayoutState,
  adjustComposerTextareaElement,
  resolveComposerKeyAction,
  resolveComposerPlaceholder,
  type ResolveComposerPlaceholderOptions,
} from './composer-sizing';

export { resolveComposerPlaceholder, type ResolveComposerPlaceholderOptions };

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useComposerInputMode() {
  const prefersTouchInteraction = useMediaQuery('(pointer: coarse) and (hover: none)');

  return {
    prefersTouchInteraction,
    enterToSend: !prefersTouchInteraction,
  };
}

export interface AgentSessionComposerProps {
  onSend: (text: string) => void | Promise<void>;
  onCancel?: () => void;
  isRunning?: boolean;
  hasActiveTurn?: boolean;
  canCancel?: boolean;
  isProviderAvailable?: boolean;
  disabled?: boolean;
  loadError?: unknown;
  currentMode: AgentExecutionMode;
  onModeChange: (mode: AgentExecutionMode) => void;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function AgentSessionComposer({
  onSend,
  onCancel,
  isRunning = false,
  hasActiveTurn,
  canCancel = true,
  isProviderAvailable = true,
  disabled = false,
  loadError,
  currentMode,
  onModeChange,
  placeholder,
  textareaRef: externalTextareaRef,
}: AgentSessionComposerProps) {
  const [draft, setDraft] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const { enterToSend } = useComposerInputMode();

  const adjustHeight = useCallback(() => {
    adjustComposerTextareaElement(textareaRef.current, isFocused);
  }, [isFocused, textareaRef]);

  useIsomorphicLayoutEffect(() => {
    adjustHeight();
  }, [draft, isFocused, adjustHeight]);

  const showCancelAction = hasActiveTurn !== undefined ? hasActiveTurn : isRunning;
  const isDisabled = disabled || !isProviderAvailable || Boolean(loadError) || isRunning || Boolean(hasActiveTurn);

  const resolvedPlaceholder = resolveComposerPlaceholder({
    loadError,
    isProviderAvailable,
    isRunning,
    hasActiveTurn,
    disabled,
    placeholder,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = resolveComposerKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      enterToSend,
    });

    if (action === 'send') {
      event.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || showCancelAction || isDisabled) return;
    setDraft('');
    onSend(trimmed);
  };

  const layoutState = getComposerLayoutState({ isFocused });

  return (
    <div
      className={cn(
        'relative rounded-2xl border bg-surface transition-all duration-200 ease-out',
        isFocused ? 'border-accent shadow-lg ring-1 ring-accent' : 'border-border hover:border-border-strong',
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
            placeholder={resolvedPlaceholder}
            className={cn(
              'w-full resize-none bg-transparent px-4 pt-3 pb-2 text-base transition-all duration-150 outline-none placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm',
              layoutState.className,
            )}
          />
        </label>

        {/* Footer controls: Mode switcher on left, Send/Cancel on right */}
        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
          {/* Mode Switcher */}
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5 text-[10px]">
            {AI_MODES.map((modeMeta) => (
              <button
                key={modeMeta.id}
                type="button"
                onClick={() => onModeChange(modeMeta.id)}
                className={cn(
                  'rounded px-2 py-1 text-[9px] font-semibold tracking-wider uppercase transition-colors',
                  currentMode === modeMeta.id ? 'bg-accent text-fg-on-accent' : 'text-fg-muted hover:text-fg-primary',
                )}
                title={`${modeMeta.label} - ${modeMeta.description}`}
                aria-label={`${modeMeta.label}: ${modeMeta.description}`}
                disabled={isDisabled}
              >
                {modeMeta.id}
              </button>
            ))}
          </div>

          {/* Action button: Send or Stop */}
          <div>
            {showCancelAction ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onCancel}
                disabled={!canCancel}
                className="h-8 gap-1.5 px-3 text-xs font-semibold text-status-error hover:bg-status-error/10 hover:text-status-error"
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
