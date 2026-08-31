import { createFileRoute } from '@tanstack/react-router';
import { ActiveSpecificationsRoute } from '@/features/specifications/list/active-specifications-route';

export const Route = createFileRoute('/_spec-layout/')({
  component: ActiveSpecificationsRoute,
});
