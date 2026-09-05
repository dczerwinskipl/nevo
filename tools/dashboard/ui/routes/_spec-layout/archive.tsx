import { createFileRoute } from '@tanstack/react-router';
import { ArchiveSpecificationsPage } from '@/features/specifications/list/archive-specifications-page';

export const Route = createFileRoute('/_spec-layout/archive')({
  component: ArchiveSpecificationsPage,
});
