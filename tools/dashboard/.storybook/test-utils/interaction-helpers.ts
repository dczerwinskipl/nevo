import { userEvent } from 'storybook/test';

/**
 * Disables CSS transitions on the element before hovering, guaranteeing
 * deterministic computed styles immediately without waiting for CSS animations.
 */
export async function hoverWithNoTransition(el: HTMLElement): Promise<void> {
  el.style.setProperty('transition', 'none', 'important');
  try {
    const browser = await import('vitest/browser');
    if (browser?.page) {
      await browser.page.elementLocator(el).hover();
      return;
    }
  } catch {
    // fallback
  }
  await userEvent.hover(el);
}

export async function unhoverWithNoTransition(el: HTMLElement): Promise<void> {
  try {
    const browser = await import('vitest/browser');
    if (browser?.page) {
      await browser.page.elementLocator(el).unhover();
      el.style.removeProperty('transition');
      return;
    }
  } catch {
    // fallback
  }
  await userEvent.unhover(el);
  el.style.removeProperty('transition');
}
