export interface ComposerLayoutConfig {
  isFocused: boolean;
}

export interface ComposerLayoutState {
  isCompact: boolean;
  isExpanded: boolean;
  overflow: 'hidden' | 'auto';
  className: string;
}

export const COMPOSER_COMPACT_CLASSES = 'min-h-11 max-h-12 overflow-hidden';
export const COMPOSER_EDIT_CLASSES = 'min-h-11 max-h-[40vh] overflow-y-auto';

/**
 * Returns static CSS classes and presentation state based on focus status.
 */
export function getComposerLayoutState({ isFocused }: ComposerLayoutConfig): ComposerLayoutState {
  if (!isFocused) {
    return {
      isCompact: true,
      isExpanded: false,
      overflow: 'hidden',
      className: COMPOSER_COMPACT_CLASSES,
    };
  }

  return {
    isCompact: false,
    isExpanded: true,
    overflow: 'auto',
    className: COMPOSER_EDIT_CLASSES,
  };
}

export interface TextareaAdjustmentResult {
  height: string;
  overflowY: 'hidden' | 'auto';
  isCompact: boolean;
  scrollHeight: number;
}

/**
 * Deterministic DOM measurement and application boundary for textarea auto-grow.
 * Can be tested deterministically in unit and integration tests with mock or real DOM elements.
 */
export function adjustComposerTextareaElement(
  element: HTMLTextAreaElement | { style: { height: string; overflowY?: string }; scrollHeight: number } | null,
  isFocused: boolean
): TextareaAdjustmentResult {
  if (!element) {
    return { height: '', overflowY: isFocused ? 'auto' : 'hidden', isCompact: !isFocused, scrollHeight: 0 };
  }

  if (!isFocused) {
    element.style.height = '';
    return { height: '', overflowY: 'hidden', isCompact: true, scrollHeight: element.scrollHeight || 0 };
  }

  // Reset inline height to 'auto' first to measure natural content shrink/growth
  element.style.height = 'auto';
  const scrollHeight = element.scrollHeight;
  const newHeight = `${scrollHeight}px`;
  element.style.height = newHeight;

  return {
    height: newHeight,
    overflowY: 'auto',
    isCompact: false,
    scrollHeight,
  };
}

export interface ComposerKeyActionParams {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  enterToSend: boolean;
}

export type ComposerKeyAction = 'send' | 'newline' | 'none';

/**
 * Resolves keyboard action based on key state, IME composition, and modality (enterToSend).
 */
export function resolveComposerKeyAction({
  key,
  shiftKey,
  isComposing = false,
  enterToSend,
}: ComposerKeyActionParams): ComposerKeyAction {
  if (key !== 'Enter') return 'none';
  if (shiftKey) return 'newline';
  if (isComposing) return 'newline';
  if (enterToSend) return 'send';
  return 'newline';
}

export interface ResolveComposerPlaceholderOptions {
  loadError?: unknown;
  isProviderAvailable?: boolean;
  isRunning?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Resolves composer placeholder text based on strict status precedence:
 * 1. Explicit custom placeholder (if provided)
 * 2. Load error (session not found / server unreachable)
 * 3. Provider CLI unavailable
 * 4. Active Turn running ("Turn trwa…")
 * 5. Genuinely read-only/disabled session ("Ta sesja jest tylko do odczytu")
 * 6. Normal composer ready state ("Napisz wiadomość…")
 */
export function resolveComposerPlaceholder({
  loadError,
  isProviderAvailable = true,
  isRunning = false,
  disabled = false,
  placeholder,
}: ResolveComposerPlaceholderOptions): string {
  if (placeholder) return placeholder;
  if (loadError) {
    return 'kind' in (loadError as any) && (loadError as any).kind === 'not_found'
      ? 'Sesja nie została znaleziona...'
      : 'Serwer dashboardu jest niedostępny...';
  }
  if (!isProviderAvailable) return 'Provider CLI niedostępny (brak w PATH)';
  if (isRunning) return 'Turn trwa…';
  if (disabled) return 'Ta sesja jest tylko do odczytu';
  return 'Napisz wiadomość…';
}


