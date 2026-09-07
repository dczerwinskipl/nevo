import { createFileRoute } from '@tanstack/react-router';
import { SpecificationConsoleLayout } from '@/screens/specification-console/specification-console-layout';

export const Route = createFileRoute('/_spec-layout')({
  component: SpecificationConsoleLayout,
});
