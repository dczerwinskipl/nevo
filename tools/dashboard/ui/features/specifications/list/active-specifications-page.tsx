import { useSpecificationIndex } from '../queries';
import { SpecificationList } from './specification-list';

export function ActiveSpecificationsPage() {
  const { data } = useSpecificationIndex();
  const specifications = data?.active ?? [];

  return <SpecificationList mode="active" specifications={specifications} />;
}
