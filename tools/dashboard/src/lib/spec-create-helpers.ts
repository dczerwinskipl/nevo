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
