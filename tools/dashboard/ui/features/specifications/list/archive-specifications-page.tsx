import { useSpecificationIndex } from '../queries';
import { SpecificationList } from './specification-list';

export function ArchiveSpecificationsPage() {
  const { data } = useSpecificationIndex();
  const specifications = data?.archive ?? [];

  return <SpecificationList mode="archive" specifications={specifications} />;
}
