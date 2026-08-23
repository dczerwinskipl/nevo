export interface ComposerLayoutConfig {
  isFocused: boolean;
  draft: string;
  scrollHeight?: number;
  maxHeightPx?: number;
}

export interface ComposerLayoutState {
  isCompact: boolean;
  isExpanded: boolean;
  overflow: 'hidden' | 'auto';
  className: string;
  computedHeightPx?: number;
}

export const COMPOSER_COMPACT_CLASSES = 'min-h-11 max-h-12 overflow-hidden';
export const COMPOSER_EDIT_BASE_CLASSES = 'min-h-11 max-h-[40vh]';

/**
 * Pure deterministic state and sizing calculator for chat composer.
 * Compact while unfocused regardless of draft length, auto-growing when focused.
 */
export function getComposerLayoutState({
  isFocused,
  draft,
  scrollHeight,
  maxHeightPx,
}: ComposerLayoutConfig): ComposerLayoutState {
  if (!isFocused) {
    return {
      isCompact: true,
      isExpanded: false,
      overflow: 'hidden',
      className: COMPOSER_COMPACT_CLASSES,
    };
  }

  const isExceedingMax = Boolean(scrollHeight && maxHeightPx && scrollHeight > maxHeightPx);

  return {
    isCompact: false,
    isExpanded: true,
    overflow: isExceedingMax ? 'auto' : 'hidden',
    className: `${COMPOSER_EDIT_BASE_CLASSES} ${isExceedingMax ? 'overflow-y-auto' : 'overflow-hidden'}`,
    computedHeightPx: scrollHeight
      ? maxHeightPx
        ? Math.min(scrollHeight, maxHeightPx)
        : scrollHeight
      : undefined,
  };
}
