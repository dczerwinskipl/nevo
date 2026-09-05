import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Progress } from './progress';
import { resolveLiveTokenComputed, resolveLiveTokenRgba, parseCssColor } from '@storybook-test-utils';

function ProgressGallery() {
  return (
    <div className="max-w-xl space-y-8 p-4">
      <div data-testid="progress-wrapper">
        <Progress value={65} />
      </div>
    </div>
  );
}

const meta: Meta<typeof ProgressGallery> = {
  title: 'Shared/UI/Progress',
  component: ProgressGallery,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const progressWrapper = canvas.getByTestId('progress-wrapper');
    const progressBar = progressWrapper.querySelector('[role="progressbar"]') as HTMLElement;
    expect(progressBar).not.toBeNull();
    const trackStyle = window.getComputedStyle(progressBar);
    const trackColor = parseCssColor(trackStyle.backgroundColor);
    const fgPrimaryRgb = resolveLiveTokenRgba('--color-fg-primary');
    expect(trackColor[0]).toBe(fgPrimaryRgb[0]);
    expect(trackColor[1]).toBe(fgPrimaryRgb[1]);
    expect(trackColor[2]).toBe(fgPrimaryRgb[2]);
    expect(trackColor[3]).toBeCloseTo(0.07, 2);

    const indicator = progressBar.firstElementChild as HTMLElement;
    expect(indicator).not.toBeNull();
    const indicatorStyle = window.getComputedStyle(indicator);
    expect(indicatorStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-accent'));
  },
};
