import { expect } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

/** Desktop browser automation stages the geometry; native keyboard acceptance stays on iPhone. */
export async function continuousSearch(page: Page, input: Locator, text: string) {
  await input.click();
  await page.evaluate(() => {
    const root = document.documentElement;
    root.dataset['keyboard'] = 'open';
    root.style.setProperty('--keyboard-inset', '336px');
    root.style.setProperty('--visual-viewport-height', `${innerHeight - 336}px`);
  });
  // Settle the existing screen arrival before measuring typing geometry.
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  const original = await input.elementHandle();
  const screen = await page.locator('[data-screen]').first().elementHandle();
  const top = (await input.boundingBox())!.y;
  const url = page.url();
  for (const char of text) {
    await page.keyboard.type(char);
    await expect(input).toBeFocused();
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await screen!.evaluate((node) => node.isConnected)).toBe(true);
    expect(Math.abs((await input.boundingBox())!.y - top)).toBeLessThan(2);
    expect(page.url()).toBe(url);
  }
  await expect(input).toHaveValue(text);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('X');
  await expect(input).toHaveValue(`${text.slice(0, -1)}X${text.slice(-1)}`);
  expect(await input.evaluate((node) => (node as HTMLInputElement).selectionStart)).toBe(
    text.length,
  );
  await page.keyboard.press('Backspace');
  await page.keyboard.press('End');
  await expect(input).toHaveValue(text);
}
