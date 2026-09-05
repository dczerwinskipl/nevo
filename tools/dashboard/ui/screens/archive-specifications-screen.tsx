import { useSpecificationIndex } from '@/features/specifications/queries';
import { SpecificationList } from '@/features/specifications/list/specification-list';

export function ArchiveSpecificationsScreen() {
  const { data } = useSpecificationIndex();
  const specifications = data?.archive ?? [];

  return <SpecificationList mode="archive" specifications={specifications} />;
}

export const ArchiveSpecificationsRoute = ArchiveSpecificationsScreen;
