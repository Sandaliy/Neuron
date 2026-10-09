import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

test('Study disclosure moves surrounding layout continuously and reverses mid-flight', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  const button = page.getByRole('button', { name: 'Study setup', exact: true });
  await expect(button).toBeVisible();
  const frames = await button.evaluate(async (button) => {
    const content = document.getElementById(button.getAttribute('aria-controls')!)!;
    const heights: number[] = [];
    const times: number[] = [];
    const collect = (duration: number) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const sample = (time: number) => {
          const height = content.getBoundingClientRect().height;
          // Chromium can deliver a duplicate initial frame. Omit only an
          // identical sample; movement at zero elapsed time must still fail.
          if (times.at(-1) !== time || heights.at(-1) !== height) {
            heights.push(height);
            times.push(time);
          }
          if (performance.now() - start < duration) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
    (button as HTMLButtonElement).click();
    await collect(300);
    (button as HTMLButtonElement).click();
    await collect(70);
    const beforeReverse = content.getBoundingClientRect().height;
    (button as HTMLButtonElement).click();
    await collect(300);
    const token = getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim();
    return {
      heights,
      beforeReverse,
      times,
      duration: Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000),
    };
  });
  await info.attach('disclosure-frames', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  expect(
    frames.heights.filter((height) => height > 1 && height < Math.max(...frames.heights) - 1)
      .length,
  ).toBeGreaterThan(3);
  const maximum = Math.max(...frames.heights);
  expect(frames.beforeReverse).toBeGreaterThan(0);
  expect(frames.beforeReverse).toBeLessThan(maximum - 1);
  // Use frame timestamps: delayed callbacks can execute less than 1ms apart.
  // WebKit can sample at 20–30Hz; do not assume each frame lasts 16ms. The
  // easing peaks around 3x average speed, with subpixel layout quantization.
  const changes = frames.heights
    .slice(1)
    .map((height, index) => Math.abs(height - frames.heights[index]!));
  const speeds = changes.map(
    (change, index) => change / (frames.times[index + 1]! - frames.times[index]!),
  );
  expect(Math.max(...changes)).toBeLessThan(maximum * 0.75);
  expect(Math.max(...speeds)).toBeLessThan((maximum * 4) / frames.duration);
  expect(frames.heights.at(-1)).toBeCloseTo(maximum, 0);
});
