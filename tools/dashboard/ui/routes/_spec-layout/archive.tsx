import { createFileRoute } from '@tanstack/react-router';
import { ArchiveSpecificationsRoute } from '@/features/specifications/list/archive-specifications-route';

export const Route = createFileRoute('/_spec-layout/archive')({
  component: ArchiveSpecificationsRoute,
});
