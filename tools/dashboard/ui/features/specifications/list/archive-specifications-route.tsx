import { useSpecificationIndex } from '../queries';
import { SpecificationList } from './specification-list';

export function ArchiveSpecificationsRoute() {
  const { data } = useSpecificationIndex();
  const changes = data?.archive ?? [];

  return <SpecificationList mode="archive" changes={changes} />;
}
