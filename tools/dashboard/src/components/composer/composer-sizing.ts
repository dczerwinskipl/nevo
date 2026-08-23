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

