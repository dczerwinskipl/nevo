import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { resolveLiveTokenComputed } from '@storybook-test-utils';

function SmokeFoundation() {
  return (
    <div className="space-y-4 p-8">
      <h1 className="text-2xl font-bold text-fg-primary">Storybook Smoke Verification</h1>
      <p className="text-fg-muted">Testing typography, theme tokens, and Tailwind v4 compilation.</p>
      <div className="flex items-center gap-3">
        <span className="inline-block h-4 w-4 rounded-full bg-status-success" />
        <span className="font-medium text-status-success">Theme tokens active</span>
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

    // 2. Verify semantic status-success utility resolves to live --color-status-success token
    const expectedSuccess = resolveLiveTokenComputed('--color-status-success');
    const indicator = canvasElement.querySelector('.bg-status-success') as HTMLElement;
    expect(indicator).not.toBeNull();
    expect(window.getComputedStyle(indicator).backgroundColor).toBe(expectedSuccess);

    // 3. Verify preview body has production font family and live foreground color
    const bodyStyle = window.getComputedStyle(document.body);
    expect(bodyStyle.fontFamily).toContain('Inter');
    expect(bodyStyle.color).toBe(resolveLiveTokenComputed('--color-fg-primary'));

    // 4. Verify html background resolves to live --color-background token and dark color scheme
    const htmlStyle = window.getComputedStyle(document.documentElement);
    expect(htmlStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-background'));
    expect(htmlStyle.colorScheme).toBe('dark');
    expect(bodyStyle.backgroundImage).toContain('radial-gradient');
  },
};
