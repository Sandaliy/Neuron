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

test('Grammar reveals complete text, preserves mounted controls and aligns German toggles', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      json: {
        decks: [
          {
            id: 'd5',
            kind: 'deck',
            name: 'Grammar deck',
            parentId: null,
            path: [],
            children: [],
            settings: { targetLanguage: 'de' },
            due: 0,
            fresh: 0,
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/notes/new?deckId=d5');
  await page.getByLabel('Part of speech', { exact: true }).selectOption('verb');
  const grammar = page.getByRole('button', { name: 'Grammar', exact: true });
  const frames = await grammar.evaluate(async (button) => {
    const content = document.getElementById(button.getAttribute('aria-controls')!)!;
    const inner = content.firstElementChild!;
    const frames: Array<{ height: number; visible: boolean; complete: boolean }> = [];
    (button as HTMLButtonElement).click();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        const height = content.getBoundingClientRect().height;
        const style = getComputedStyle(inner);
        frames.push({
          height,
          visible: style.visibility !== 'hidden' && Number(style.opacity) > 0.01,
          complete: height >= inner.getBoundingClientRect().height - 1,
        });
        if (performance.now() - start < 500) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
  await info.attach('grammar-reveal-frames', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  expect(frames.filter((frame) => frame.height > 1 && !frame.complete).length).toBeGreaterThan(3);
  expect(frames.some((frame) => frame.visible && !frame.complete)).toBe(false);
  const past = page.getByLabel('Präteritum', { exact: true });
  await past.fill('ging');
  await past.evaluate((element) => {
    (element as HTMLInputElement).dataset['retained'] = 'true';
  });
  await grammar.click();
  await expect(grammar).toHaveAttribute('aria-expanded', 'false');
  await expect(past).toHaveCount(1);
  await grammar.click();
  await expect(past).toHaveValue('ging');
  expect(await past.getAttribute('data-retained')).toBe('true');
  for (const [choice, toggle] of [
    ['Auxiliary', 'Separable'],
    ['Takes the case', 'Reflexive'],
  ]) {
    const control = await page.getByLabel(choice!, { exact: true }).boundingBox();
    const boolean = await page.getByRole('switch', { name: toggle!, exact: true }).boundingBox();
    expect(
      Math.abs(control!.y + control!.height / 2 - boolean!.y - boolean!.height / 2),
    ).toBeLessThan(1);
  }
  await page.setViewportSize({ width: 280, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(280);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await grammar.click();
  await grammar.click();
  await expect(past).toBeVisible();
  await expect(past).toHaveValue('ging');
});

test('security panel entrance has intermediate frames and keeps focus and actions reachable', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  await page.goto('/settings');
  const frames = await page
    .getByRole('button', { name: 'Change your password', exact: true })
    .evaluate(async (button) => {
      (button as HTMLButtonElement).click();
      const frames: Array<{ opacity: number; top: number; elapsed: number }> = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const sample = () => {
          const panel = document.querySelector('[role="dialog"]');
          if (panel)
            frames.push({
              opacity: Number(getComputedStyle(panel).opacity),
              top: panel.getBoundingClientRect().top,
              elapsed: performance.now() - start,
            });
          if (performance.now() - start < 350) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      return frames;
    });
  await info.attach('security-panel-frames', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  // Windows WebKit can deliver coarse frames. Check visible entrance milestones
  // rather than assuming a rendering frequency; Chromium FPS budgets are separate.
  expect(frames[0]!.opacity).toBeLessThanOrEqual(0.01);
  expect(frames.some((frame) => frame.opacity > 0.01 && frame.opacity < 0.99)).toBe(true);
  expect(frames.at(-1)!.opacity).toBe(1);
  await expect(page.getByRole('dialog')).toBeFocused();
  await page.getByLabel('Current password', { exact: true }).focus();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--visual-viewport-height', '476px');
    document.documentElement.style.setProperty('--visual-viewport-top', '40px');
  });
  const panel = await page.getByRole('dialog').boundingBox();
  const action = await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(40);
  expect(action!.y + action!.height).toBeLessThanOrEqual(516);
  await page.getByLabel('New password', { exact: true }).focus();
  await expect(page.getByLabel('New password', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
