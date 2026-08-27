import type { SpecificationManifest } from '@/lib/types';

export interface DocItem {
  id: string;
  docId: string;
  title: string;
  path?: string | null;
  sectionId: string;
  sectionLabel: string;
  icon?: string;
}

export interface DocGroup {
  id: string;
  label: string;
  icon?: string;
  items: DocItem[];
}

/** Pure projection of a specification manifest into documentation nav groups. */
export function buildDocGroups(manifest: SpecificationManifest | null | undefined): DocGroup[] {
  if (!manifest) return [];
  const result: DocGroup[] = [];

  if (manifest.sections && manifest.sections.length > 0) {
    for (const section of manifest.sections) {
      if (!section.available) continue;
      if (section.type === 'document' && section.document) {
        result.push({
          id: section.id,
          label: section.label,
          icon: section.icon,
          items: [
            {
              id: section.document.id || section.id,
              docId: section.document.docId || (section.id === 'specification' ? 'overview' : section.id),
              title: section.document.title || section.label,
              path: section.document.path,
              sectionId: section.id,
              sectionLabel: section.label,
              icon: section.icon,
            },
          ],
        });
      } else if (section.type === 'directory' && section.documents?.length > 0) {
        result.push({
          id: section.id,
          label: section.label,
          icon: section.icon,
          items: section.documents.map((doc) => ({
            id: doc.id,
            docId: doc.docId,
            title: doc.title,
            path: doc.path,
            sectionId: section.id,
            sectionLabel: section.label,
            icon: section.icon,
          })),
        });
      }
    }
    return result;
  }

  if (manifest.overview?.available) {
    result.push({
      id: 'specification',
      label: 'Specyfikacja',
      icon: 'BookOpenText',
      items: [
        {
          id: 'overview',
          docId: 'overview',
          title: manifest.overview.title || 'Specyfikacja',
          path: manifest.overview.path || 'overview.md',
          sectionId: 'specification',
          sectionLabel: 'Specyfikacja',
          icon: 'BookOpenText',
        },
      ],
    });
  }
  if (manifest.areas && manifest.areas.length > 0) {
    result.push({
      id: 'areas',
      label: 'Obszary',
      icon: 'Boxes',
      items: manifest.areas.map((area) => ({
        id: area.id,
        docId: area.docId,
        title: area.title,
        path: area.path,
        sectionId: 'areas',
        sectionLabel: 'Obszary',
        icon: 'Boxes',
      })),
    });
  }

  return result;
}

export type SpecTabId = 'overview' | 'docs' | 'changes';

export interface SpecTabDescriptor {
  id: SpecTabId;
  label: string;
}

const SPEC_TABS: Record<SpecTabId, SpecTabDescriptor> = {
  overview: { id: 'overview', label: 'Przegląd' },
  docs: { id: 'docs', label: 'Dokumentacja' },
  changes: { id: 'changes', label: 'Zmiany' },
};

/** Pure projection of which spec-detail tabs are visible for a given manifest. */
export function computeVisibleTabs(manifest: SpecificationManifest | null | undefined): SpecTabDescriptor[] {
  const hasDocs = Boolean(
    (manifest?.sections && manifest.sections.some((s) => s.available)) ||
    manifest?.overview?.available ||
    (manifest?.areas && manifest.areas.length > 0)
  );

  return hasDocs
    ? [SPEC_TABS.overview, SPEC_TABS.docs, SPEC_TABS.changes]
    : [SPEC_TABS.overview, SPEC_TABS.changes];
}
