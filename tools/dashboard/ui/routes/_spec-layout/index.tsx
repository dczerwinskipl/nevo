import { createFileRoute } from '@tanstack/react-router';
import { ActiveSpecificationsScreen } from '@/screens/active-specifications-screen';

export const Route = createFileRoute('/_spec-layout/')({
  component: ActiveSpecificationsScreen,
});
