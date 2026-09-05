import { useSpecificationIndex } from '@/features/specifications/queries';
import { SpecificationList } from '@/features/specifications/list/specification-list';

export function ActiveSpecificationsScreen() {
  const { data } = useSpecificationIndex();
  const specifications = data?.active ?? [];

  return <SpecificationList mode="active" specifications={specifications} />;
}

export const ActiveSpecificationsRoute = ActiveSpecificationsScreen;
