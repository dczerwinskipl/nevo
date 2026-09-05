import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Canonical StatusTone union representing ongoing state tones (D2, D8).
 * Exactly 7 values: neutral, active, success, warning, error, attention, info.
 * action-destructive is an action classification role, not an ongoing status tone,
 * and is intentionally not part of this type.
 */
export type StatusTone = 'neutral' | 'active' | 'success' | 'warning' | 'error' | 'attention' | 'info';

/**
 * Focused text-only presentation recipe for status tone foregrounds.
 */
export const statusTextTone = cva('', {
  variants: {
    tone: {
      neutral: 'text-status-neutral',
      active: 'text-status-active',
      success: 'text-status-success',
      warning: 'text-status-warning',
      error: 'text-status-error',
      attention: 'text-status-attention',
      info: 'text-status-info',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
});

export type StatusTextToneProps = VariantProps<typeof statusTextTone>;

/**
 * Focused surface presentation recipe (border, bg, text) using the
 * opacity-modifier convention (border-status-X/25 bg-status-X/10 text-status-X).
 */
export const statusSurfaceTone = cva('border', {
  variants: {
    tone: {
      neutral: 'border-status-neutral/25 bg-status-neutral/10 text-status-neutral',
      active: 'border-status-active/25 bg-status-active/10 text-status-active',
      success: 'border-status-success/25 bg-status-success/10 text-status-success',
      warning: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
      error: 'border-status-error/25 bg-status-error/10 text-status-error',
      attention: 'border-status-attention/25 bg-status-attention/10 text-status-attention',
      info: 'border-status-info/25 bg-status-info/10 text-status-info',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
});

export type StatusSurfaceToneProps = VariantProps<typeof statusSurfaceTone>;
