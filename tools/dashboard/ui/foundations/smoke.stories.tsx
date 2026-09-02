import type { Meta, StoryObj } from '@storybook/react-vite';

function SmokeFoundation() {
  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold text-[var(--foreground)]">Storybook Smoke Verification</h1>
      <p className="text-[var(--muted)]">Testing typography, theme tokens, and Tailwind v4 compilation.</p>
      <div className="flex items-center gap-3">
        <span className="inline-block h-4 w-4 rounded-full bg-[var(--success)]" />
        <span className="font-medium text-[var(--success)]">Theme tokens active</span>
      </div>
    </div>
  );
}

const meta: Meta<typeof SmokeFoundation> = {
  title: 'Foundations/Smoke',
  component: SmokeFoundation,
};

export default meta;
type Story = StoryObj<typeof SmokeFoundation>;

export const Default: Story = {};
