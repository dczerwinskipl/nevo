import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useState } from 'react';

import { Button } from './button';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './dialog';
import { resolveLiveTokenComputed, resolveLiveTokenRgba, parseCssColor } from '@storybook-test-utils';

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-6">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button data-testid="open-dialog-btn" variant="secondary">
            Otwórz okno dialogowe
          </Button>
        </DialogTrigger>
        <DialogContent data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle data-testid="dialog-title">Tytuł okna dialogowego</DialogTitle>
            <DialogDescription data-testid="dialog-desc">
              To jest opis okna dialogowego weryfikujący tokeny semantyczne.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const meta: Meta<typeof Dialog> = {
  title: 'Shared/UI/Dialog',
  component: Dialog,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  render: () => <DialogDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByTestId('open-dialog-btn');

    // 1. Initially closed
    expect(document.querySelector('[data-testid="dialog-content"]')).toBeNull();

    // 2. Open dialog
    await userEvent.click(openBtn);
    const content = await within(document.body).findByTestId('dialog-content');
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

    // 4. Scoped title and description colors
    const title = within(content).getByTestId('dialog-title');
    expect(window.getComputedStyle(title).color).toBe(resolveLiveTokenComputed('--color-fg-primary'));

    const desc = within(content).getByTestId('dialog-desc');
    expect(window.getComputedStyle(desc).color).toBe(resolveLiveTokenComputed('--color-fg-muted'));

    // 5. Close dialog and assert content is removed from DOM
    const closeBtn = within(content).getByRole('button', { name: 'Zamknij' });
    await userEvent.click(closeBtn);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="dialog-content"]')).toBeNull();
    });
  },
};
