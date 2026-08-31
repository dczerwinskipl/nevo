import { createFileRoute } from '@tanstack/react-router';
import { SpecificationConsoleLayout } from '@/features/specifications/specification-console-layout';

export const Route = createFileRoute('/_spec-layout')({
  component: SpecificationConsoleLayout,
});
