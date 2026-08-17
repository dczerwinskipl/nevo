/**
 * Declarative configuration of specification sections for the NEvo dashboard.
 *
 * Each section can be of type:
 *   - 'document': points to a single markdown file (or candidate files in priority order).
 *   - 'directory': points to a directory containing markdown files (master-detail list view).
 *
 * Optional 'template' can specify a custom UI template/component identifier.
 */
export const DEFAULT_SPEC_SECTIONS = Object.freeze([
  {
    id: 'specification',
    label: 'Specyfikacja',
    type: 'document',
    file: ['overview.md', 'spec.md'],
    docId: 'overview',
    icon: 'BookOpenText',
    template: 'document',
  },
  {
    id: 'areas',
    label: 'Obszary',
    singularLabel: 'Obszar',
    type: 'directory',
    dir: 'areas',
    docIdPrefix: 'area',
    icon: 'Boxes',
    template: 'directory',
  },
  {
    id: 'solution-options',
    label: 'Opcje rozwiązań',
    type: 'document',
    file: 'solution-options.md',
    docId: 'solution-options',
    icon: 'Workflow',
    template: 'document',
  },
  {
    id: 'decisions',
    label: 'Decyzje',
    type: 'document',
    file: ['owner-decisions.md', 'decisions.md'],
    docId: 'decisions',
    icon: 'Scale',
    template: 'document',
  },
  {
    id: 'reviews',
    label: 'Recenzje',
    singularLabel: 'Recenzja',
    type: 'directory',
    dir: 'reviews',
    docIdPrefix: 'review',
    icon: 'ClipboardCheck',
    template: 'directory',
  },
]);
