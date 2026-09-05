import { createFileRoute } from '@tanstack/react-router';
import { SpecificationDetailScreen } from '@/screens/specification-detail/specification-detail-screen';

export const Route = createFileRoute('/_spec-layout/specs/$source/$slug')({
  component: SpecificationRouteEntry,
});

function SpecificationRouteEntry() {
  const { source, slug } = Route.useParams();
  return <SpecificationDetailScreen source={source} slug={slug} />;
}
