import { createFileRoute } from '@tanstack/react-router';
import { SpecificationRoute } from '@/features/specifications/detail/specification-route';

export const Route = createFileRoute('/_spec-layout/specs/$source/$slug')({
  component: SpecificationRouteEntry,
  validateSearch: () => ({}),
});

function SpecificationRouteEntry() {
  const { source, slug } = Route.useParams();
  return <SpecificationRoute source={source} slug={slug} />;
}
