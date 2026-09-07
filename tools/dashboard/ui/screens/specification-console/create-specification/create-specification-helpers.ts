import type { AgentExecutionMode } from '@/features/agent-sessions/types';

export const SPEC_TYPES_OPTIONS = [
  { id: 'standard', label: 'Standard (T)', desc: 'Typowa zmiana / nowe moduły' },
  { id: 'architectural', label: 'Architektoniczny (A)', desc: 'Zmiany architektury i persystencji' },
  { id: 'small', label: 'Mały (S)', desc: 'Drobne poprawki i refaktoryzacja' },
  { id: 'exploratory', label: 'Eksploracyjny (E)', desc: 'Spike i badania' },
] as const;

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[ąàáâäæ]/g, 'a')
    .replace(/[ćç]/g, 'c')
    .replace(/[ęèéêë]/g, 'e')
    .replace(/[ł]/g, 'l')
    .replace(/[ńñ]/g, 'n')
    .replace(/[óòôöø]/g, 'o')
    .replace(/[śš]/g, 's')
    .replace(/[źż]/g, 'z')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolves the deterministic default execution mode for the specification planning wizard.
 *
 * Invariant (Task 13 & Task 15):
 * 1. Prefer 'ask' (read-only planning & analysis) if supported by the provider.
 * 2. Otherwise use the provider's declared defaultMode (if supported and NOT 'agent').
 * 3. Otherwise fall back to 'edit'.
 *
 * Never silently or automatically escalate to 'agent' mode.
 */
export function resolveDefaultPlanningMode(
  provider?: {
    supportedModes?: AgentExecutionMode[];
    defaultMode?: AgentExecutionMode;
  } | null,
): AgentExecutionMode {
  const supported = provider?.supportedModes || ['ask', 'edit', 'agent'];
  if (supported.includes('ask')) {
    return 'ask';
  }
  if (provider?.defaultMode && supported.includes(provider.defaultMode) && provider.defaultMode !== 'agent') {
    return provider.defaultMode;
  }
  if (supported.includes('edit')) {
    return 'edit';
  }
  return 'edit';
}
