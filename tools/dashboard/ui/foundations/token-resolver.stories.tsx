import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { resolveLiveToken, resolveLiveTokenComputed, resolveLiveTokenRgba, parseCssColor } from '@storybook-test-utils';

function TokenResolverProbe() {
  return (
    <div className="space-y-2 p-4">
      <div data-testid="token-resolver-probe" className="rounded bg-surface p-3 text-fg-primary">
        Live Token and Browser Canvas Parser Verification
      </div>
    </div>
  );
}

const meta: Meta<typeof TokenResolverProbe> = {
  title: 'Foundations/TokenResolver',
  component: TokenResolverProbe,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const LiveTokenResolver: Story = {
  play: async () => {
    // 1. Resolving a nonexistent token throws explicitly
    expect(() => resolveLiveTokenComputed('--color-nonexistent')).toThrow(
      'CSS token "--color-nonexistent" is not defined on document.documentElement',
    );

    // 2. Core semantic tokens resolve dynamically from document.documentElement without hardcoded values
    const accentDeclared = resolveLiveToken('--color-accent');
    expect(accentDeclared).toBeTruthy();

    const accentComputed = resolveLiveTokenComputed('--color-accent');
    expect(accentComputed).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);

    const accentRgba = resolveLiveTokenRgba('--color-accent');
    expect(accentRgba[0]).toBeGreaterThanOrEqual(0);
    expect(accentRgba[1]).toBeGreaterThanOrEqual(0);
    expect(accentRgba[2]).toBeGreaterThanOrEqual(0);
    expect(accentRgba[3]).toBe(1);

    const bgComputed = resolveLiveTokenComputed('--color-background');
    expect(bgComputed).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);

    const surfaceComputed = resolveLiveTokenComputed('--color-surface');
    expect(surfaceComputed).toMatch(/^rgb\(\d+,\s*\d+,\s*\d+\)$/);

    // 3. Legacy bridge variables resolve to the exact same computed values as canonical tokens
    expect(resolveLiveTokenComputed('--background')).toBe(resolveLiveTokenComputed('--color-background'));
    expect(resolveLiveTokenComputed('--surface')).toBe(resolveLiveTokenComputed('--color-surface'));
    expect(resolveLiveTokenComputed('--border')).toBe(resolveLiveTokenComputed('--color-border'));
    expect(resolveLiveTokenComputed('--accent')).toBe(resolveLiveTokenComputed('--color-accent'));
    expect(resolveLiveTokenComputed('--foreground')).toBe(resolveLiveTokenComputed('--color-fg-primary'));
    expect(resolveLiveTokenComputed('--muted')).toBe(resolveLiveTokenComputed('--color-fg-muted'));
    expect(resolveLiveTokenComputed('--success')).toBe(resolveLiveTokenComputed('--color-status-success'));
    expect(resolveLiveTokenComputed('--warning')).toBe(resolveLiveTokenComputed('--color-status-warning'));
    expect(resolveLiveTokenComputed('--danger')).toBe(resolveLiveTokenComputed('--color-status-error'));
    expect(resolveLiveTokenComputed('--info')).toBe(resolveLiveTokenComputed('--color-status-info'));

    // 4. Backdrop token resolves with alpha channel
    const backdropRgba = resolveLiveTokenRgba('--color-backdrop');
    expect(backdropRgba[3]).toBeGreaterThan(0);
    expect(backdropRgba[3]).toBeLessThan(1);

    // 5. Fixed synthetic fixtures for parser testing (unit-testing parsing and conversion)
    expect(parseCssColor('rgb(255, 0, 128)')).toEqual([255, 0, 128, 1]);
    const translucent = parseCssColor('rgba(10, 20, 30, 0.5)');
    expect(translucent.slice(0, 3)).toEqual([10, 20, 30]);
    expect(translucent[3]).toBeCloseTo(0.5, 2);
    expect(parseCssColor('transparent')).toEqual([0, 0, 0, 0]);

    // Oklab conversion synthetic fixture
    const oklabRgba = parseCssColor('oklab(0.636841 0.187884 0.0889429)');
    expect(oklabRgba).toEqual([239, 68, 68, 1]);

    // 6. Unsupported or invalid CSS color syntax throws explicitly instead of defaulting to black
    expect(() => parseCssColor('not-a-valid-css-color')).toThrow(
      'Unsupported or invalid CSS color syntax: "not-a-valid-css-color"',
    );
  },
};
