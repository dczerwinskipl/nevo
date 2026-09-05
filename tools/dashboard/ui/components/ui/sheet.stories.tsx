import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { Button } from './button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './sheet';
import { resolveLiveTokenComputed, resolveLiveTokenRgba, parseCssColor } from '@storybook-test-utils';

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button data-testid="open-sheet-btn" variant="secondary">
            Otwórz boczny arkusz
          </Button>
        </SheetTrigger>
        <SheetContent side="right" data-testid="sheet-content">
          <SheetHeader>
            <SheetTitle data-testid="sheet-title">Tytuł arkusza</SheetTitle>
            <SheetDescription data-testid="sheet-desc">Boczny arkusz z semantycznym tłem i nakładką.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </div>
  );
}

const meta: Meta<typeof SheetDemo> = {
  title: 'Components/UI/Sheet',
  component: SheetDemo,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByTestId('open-sheet-btn');

    // 1. Initially closed
    expect(document.querySelector('[data-testid="sheet-content"]')).toBeNull();

    // 2. Open sheet
    await userEvent.click(openBtn);
    const content = await within(document.body).findByTestId('sheet-content');
    expect(content).not.toBeNull();

    // 3. Scoped portal selectors for overlay token
    const portalContainer = content.parentElement;
    expect(portalContainer).not.toBeNull();
    const overlay = portalContainer!.querySelector('.bg-backdrop') as HTMLElement;
    expect(overlay).not.toBeNull();
    const overlayColor = parseCssColor(window.getComputedStyle(overlay).backgroundColor);
    const expectedBackdrop = resolveLiveTokenRgba('--color-backdrop');
    expect(overlayColor[0]).toBe(expectedBackdrop[0]);
    expect(overlayColor[1]).toBe(expectedBackdrop[1]);
    expect(overlayColor[2]).toBe(expectedBackdrop[2]);
    expect(overlayColor[3]).toBeCloseTo(expectedBackdrop[3], 2);

    // 4. Verify sheet content uses surface-raised
    const contentStyle = window.getComputedStyle(content);
    expect(contentStyle.backgroundColor).toBe(resolveLiveTokenComputed('--color-surface-raised'));

    // 5. Close sheet and assert content is removed from DOM
    const closeBtn = within(content).getByRole('button', { name: 'Zamknij' });
    await userEvent.click(closeBtn);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="sheet-content"]')).toBeNull();
    });
  },
};
