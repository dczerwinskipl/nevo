import { createFileRoute } from '@tanstack/react-router';
import { ActiveSpecificationsPage } from '@/features/specifications/list/active-specifications-page';

export const Route = createFileRoute('/_spec-layout/')({
  component: ActiveSpecificationsPage,
});
