/**
 * Deterministic, frontend-only activity label lookup (owner-decisions.md FR-5/FR-6).
 * Presentation precedence, checked in order — never re-ordered, never skipped:
 *
 * 1. An existing meaningful structured description already supplied with the tool
 *    input (e.g. an `input.description` field), when present — used verbatim.
 * 2. Deterministic normalization from structured data already available client-side
 *    (file path, command, query, etc.).
 * 3. A generic deterministic fallback when neither tier 1 nor 2 produces anything.
 *
 * No network/model call at any tier — purely a string derivation from structured data
 * already delivered to the frontend (`AgentToolCall.input`/`toolName`).
 */

export type ActivityLabelTier = 1 | 2 | 3;

export interface ActivityLabel {
  label: string;
  tier: ActivityLabelTier;
}

interface StructuredInput {
  description?: unknown;
  path?: unknown;
  file_path?: unknown;
  filePath?: unknown;
  command?: unknown;
  pattern?: unknown;
  query?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

const GENERIC_FALLBACK = 'Running command';

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function pathOf(input: StructuredInput): string | null {
  const candidate = input.path ?? input.file_path ?? input.filePath;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

type LabelBuilder = (input: StructuredInput) => string | null;

const TIER_2_BUILDERS: Record<string, LabelBuilder> = {
  Read: (input) => {
    const path = pathOf(input);
    return path ? `Reading ${path}` : null;
  },
  Write: (input) => {
    const path = pathOf(input);
    return path ? `Writing ${path}` : null;
  },
  Edit: (input) => {
    const path = pathOf(input);
    return path ? `Editing ${path}` : null;
  },
  Bash: (input) => {
    const command = input.command;
    return typeof command === 'string' && command.trim() ? `Running: ${truncate(command, 60)}` : null;
  },
  Grep: (input) => {
    const pattern = input.pattern;
    return typeof pattern === 'string' && pattern.trim() ? `Searching for "${truncate(pattern, 40)}"` : null;
  },
  Glob: (input) => {
    const pattern = input.pattern;
    return typeof pattern === 'string' && pattern.trim() ? `Finding files matching ${truncate(pattern, 60)}` : null;
  },
  WebFetch: (input) => {
    const url = input.url;
    return typeof url === 'string' && url.trim() ? `Fetching ${truncate(url, 60)}` : null;
  },
  WebSearch: (input) => {
    const query = input.query;
    return typeof query === 'string' && query.trim() ? `Searching web for "${truncate(query, 40)}"` : null;
  },
};

function asStructuredInput(input: unknown): StructuredInput {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as StructuredInput) : {};
}

/**
 * Resolves the human-readable activity label for a tool call, applying the three-tier
 * precedence above. `toolName` alone (with no useful structured input) always resolves
 * to the tier-3 generic fallback — never a blank/undefined label.
 */
export function activityLabelFor(toolName: string, input: unknown): ActivityLabel {
  const structured = asStructuredInput(input);

  if (typeof structured.description === 'string' && structured.description.trim()) {
    return { label: structured.description.trim(), tier: 1 };
  }

  const builder = TIER_2_BUILDERS[toolName];
  const built = builder?.(structured);
  if (built) return { label: built, tier: 2 };

  return { label: GENERIC_FALLBACK, tier: 3 };
}
