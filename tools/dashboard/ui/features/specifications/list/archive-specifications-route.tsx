import { useSpecificationIndex } from '../queries';
import { SpecificationList } from './specification-list';

export function ArchiveSpecificationsRoute() {
  const { data } = useSpecificationIndex();
  const specifications = data?.archive ?? [];

  return <SpecificationList mode="archive" specifications={specifications} />;
}
