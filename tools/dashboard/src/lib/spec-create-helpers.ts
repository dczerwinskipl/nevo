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

export function generateInitialPrompt(title: string, goal: string, slug?: string): string {
  const goalText = goal.trim() || 'Define the goals, constraints, affected areas, and task decomposition.';
  const effectiveSlug = slug?.trim() || slugifyTitle(title) || 'new-specification';
  const effectiveTitle = title?.trim() || 'New Specification';

  return `[NEvo Context: Specification '${effectiveSlug}']
Title: "${effectiveTitle}"
Location: specs/active/${effectiveSlug}/
Status: draft (skeleton files change.yaml and overview.md already created)
Scope: Specification refinement and task planning

You are assisting with the existing NEvo specification '${effectiveSlug}'.
Do NOT scaffold a new or duplicate specification. Work directly on the existing files in 'specs/active/${effectiveSlug}/' (overview.md, change.yaml).

Goal:
${goalText}`;
}
