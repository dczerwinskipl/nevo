import { useSpecificationIndex } from '../queries';
import { SpecificationList } from './specification-list';

export function ActiveSpecificationsRoute() {
  const { data } = useSpecificationIndex();
  const changes = data?.active ?? [];

  return <SpecificationList mode="active" changes={changes} />;
}
