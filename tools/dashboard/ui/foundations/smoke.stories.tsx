import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

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

export const Default: Story = {
  play: async ({ canvasElement }) => {
    // 1. Verify Tailwind `text-2xl` utility produces expected computed font-size (24px)
    const h1 = canvasElement.querySelector('h1');
    expect(h1).not.toBeNull();
    const h1Style = window.getComputedStyle(h1!);
    expect(h1Style.fontSize).toBe('24px');
    expect(h1Style.lineHeight).toBe('32px');
    expect(h1Style.fontWeight).toBe('700');

    // 2. Verify production semantic custom property --success is defined (#35c76f)
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const successToken = htmlStyle.getPropertyValue('--success').trim();
    expect(successToken).toBe('#35c76f');

    // 3. Verify preview body has production font family and foreground color
    const bodyStyle = window.getComputedStyle(document.body);
    expect(bodyStyle.fontFamily).toContain('Inter');
    expect(bodyStyle.color).toBe('rgb(241, 243, 245)');

    // 4. Verify html/body production background color and radial-gradient are applied
    expect(htmlStyle.backgroundColor).toBe('rgb(9, 10, 13)');
    expect(htmlStyle.colorScheme).toBe('dark');
    expect(bodyStyle.backgroundImage).toContain('radial-gradient');
  },
};
