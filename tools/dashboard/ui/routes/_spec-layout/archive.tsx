import { createFileRoute } from '@tanstack/react-router';
import { ArchiveSpecificationsScreen } from '@/screens/archive-specifications-screen';

export const Route = createFileRoute('/_spec-layout/archive')({
  component: ArchiveSpecificationsScreen,
});
