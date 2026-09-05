/**
 * Threshold used both to decide whether a message needs a collapse affordance and, via
 * Tailwind's `line-clamp-<N>` utility, how many lines remain visible while collapsed —
 * kept as one constant so the decision and the visual clamp never drift apart.
 */
export const COLLAPSED_LINE_LIMIT = 6;

const COLLAPSE_CHAR_THRESHOLD = 480;

/**
 * Whether a message is long enough to default to a collapsed preview (FR-2). Pure and
 * independently testable per react-component-guidelines.md §7 "View models and data transformation"
 * and §10 "Testing strategy" — the component only
 * consumes the boolean, it never re-derives the thresholds inline in JSX.
 */
export function shouldCollapseMessage(text: string): boolean {
  if (!text) return false;
  const lineCount = text.split('\n').length;
  return lineCount > COLLAPSED_LINE_LIMIT || text.length > COLLAPSE_CHAR_THRESHOLD;
}
