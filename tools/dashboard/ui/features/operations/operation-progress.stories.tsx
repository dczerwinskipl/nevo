import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { OperationStepRow } from './operation-progress';
import type { OperationStep } from './types';

function OperationProgressGallery() {
  const steps: OperationStep[] = [
    { id: 's1', label: 'Inicjalizacja środowiska', status: 'completed' },
    { id: 's2', label: 'Wykonywanie migracji bazy danych', status: 'running', current: 3, total: 5 },
    { id: 's3', label: 'Weryfikacja spójności', status: 'failed', error: { message: 'Błąd walidacji schematu' } },
    { id: 's4', label: 'Czyszczenie tymczasowych plików', status: 'pending' },
  ];

  return (
    <ul className="w-full max-w-xl space-y-2 rounded-2xl bg-surface p-6" data-testid="operations-container">
      {steps.map((step) => (
        <OperationStepRow key={step.id} step={step} />
      ))}
    </ul>
  );
}

const meta: Meta<typeof OperationStepRow> = {
  title: 'Features/Operations/OperationProgress',
  component: OperationStepRow,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const OperationProgressSteps: Story = {
  render: () => <OperationProgressGallery />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const completedLabel = canvas.getByText('Inicjalizacja środowiska');
    expect(completedLabel).toHaveClass('text-fg-secondary');
    const completedRow = completedLabel.closest('li');
    expect(completedRow).toHaveClass('border-border');

    const runningLabel = canvas.getByText('Wykonywanie migracji bazy danych');
    expect(runningLabel).toHaveClass('text-status-active');
    const runningRow = runningLabel.closest('li');
    expect(runningRow).toHaveClass('border-status-active/35');

    const failedLabel = canvas.getByText('Weryfikacja spójności');
    expect(failedLabel).toHaveClass('text-status-error');
    const failedRow = failedLabel.closest('li');
    expect(failedRow).toHaveClass('border-status-error/25');

    const pendingLabel = canvas.getByText('Czyszczenie tymczasowych plików');
    expect(pendingLabel).toHaveClass('text-fg-muted');
  },
};
