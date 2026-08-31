import { useSpecificationIndex } from '../queries';
import { SpecificationList } from './specification-list';

export function ActiveSpecificationsRoute() {
  const { data } = useSpecificationIndex();
  const specifications = data?.active ?? [];

  return <SpecificationList mode="active" specifications={specifications} />;
}
