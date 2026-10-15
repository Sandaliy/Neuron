import { expect, test } from '@playwright/test';

import { manyNotes, useFixtures, usePreferences } from './fixtures';
import {
  installInteractionMetrics,
  startInteractionMetrics,
  readInteractionMetrics,
} from './interaction-metrics';
test.use({
  viewport: { width: 375, height: 812 },
  // Continuous trace screenshots repeatedly composite the full glass scene on
  // software-rendered hosted browsers. Keep DOM/network traces and a failure
  // screenshot without charging that recording work to the interaction budget.
  trace: { mode: 'retain-on-failure', screenshots: false },
  screenshot: 'only-on-failure',
});

for (const glassScope of ['all', 'floating', 'off'] as const) {
  test(`active swipe frame pacing and input latency: ${glassScope}`, async ({
    page,
    browserName,
  }, info) => {
    await installInteractionMetrics(page);
    await usePreferences(page, {
      locale: 'en',
      theme: 'dark',
      glass: glassScope === 'off' ? 'off' : 'full',
      glassScope: glassScope === 'all' ? 'all' : 'floating',
    });
    await useFixtures(page, { notes: manyNotes(5000) });
    await page.route('**/api/decks/d1/practice', (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    await page.goto('/notes?deckId=d1');
    await expect(page.locator('[data-row]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    const row = page.locator('[data-row]').first();
    await row.scrollIntoViewIfNeeded();
    const session =
      browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined;
    await session?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await startInteractionMetrics(page);
    // Trusted mouse input exercises capture, arbitration and the same moving
    // surface as touch. Native touch/compositor fidelity remains a device check.
    const bounds = (await row.boundingBox())!;
    expect(
      await row.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(bounds.right - 30, bounds.top + 25));
      }),
    ).toBe(true);
    await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + 25);
    await page.mouse.down();
    await row.evaluate(
      (row, origin) => {
        const surface = row.parentElement!;
        const root = surface.parentElement!;
        const inputs: Array<{ latency: number; error: number }> = [];
        Object.assign(window, { swipeInputs: inputs });
        let horizontal = false;
        root.addEventListener(
          'pointermove',
          (event) => {
            if (!event.isTrusted || !event.buttons) return;
            const desired = Math.min(0, event.clientX - origin);
            if (!horizontal && Math.abs(desired) < 8) return;
            horizontal = true;
            requestAnimationFrame(() => {
              const transform = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
              inputs.push({
                latency: performance.now() - event.timeStamp,
                error: Math.abs(transform.m41 - desired),
              });
            });
          },
          { capture: true },
        );
      },
      bounds.x + bounds.width - 30,
    );
    const response: number[] = [];
    for (let step = 0; step < 60; step++) {
      const x = bounds.x + bounds.width - 30 - 90 * Math.sin((step / 59) * Math.PI);
      const start = Date.now();
      await page.mouse.move(x, bounds.y + 25);
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      response.push(Date.now() - start);
    }
    await page.mouse.up();
    const metrics = await readInteractionMetrics(page);
    const fps = metrics.fps;
    // Drive a touch pointer every paint frame as well. This removes transport
    // gaps between driver calls from the active rendering budget; native touch
    // capture remains covered by the trusted gesture and WebKit touch cases.
    await startInteractionMetrics(page);
    await row.evaluate(async (row) => {
      const root = row.parentElement!.parentElement!;
      const event = (type: string, x: number) =>
        root.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 9,
            pointerType: 'touch',
            clientX: x,
            clientY: 150,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      event('pointerdown', 300);
      for (let frame = 0; frame < 180; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        event('pointermove', 300 - 90 * Math.sin((frame / 179) * Math.PI));
      }
      event('pointerup', 300);
    });
    const sustained = await readInteractionMetrics(page);
    const inputs = await page.evaluate(
      () =>
        (window as Window & { swipeInputs: Array<{ latency: number; error: number }> }).swipeInputs,
    );
    const inputMs = inputs.map((input) => input.latency).toSorted((a, b) => a - b);
    console.log(
      JSON.stringify({
        glassScope,
        fps,
        metrics,
        sustained,
        medianInputMs: inputMs[Math.floor(inputMs.length / 2)],
        p95InputMs: inputMs[Math.floor(inputMs.length * 0.95)],
      }),
    );
    await info.attach('active-swipe', {
      body: JSON.stringify({ glassScope, fps, response, metrics, sustained, inputs }),
      contentType: 'application/json',
    });
    expect(metrics.commits).toBeLessThan(10);
    expect(sustained.commits).toBeLessThan(10);
    expect(inputs.length).toBeGreaterThan(45);
    expect(Math.max(...inputs.map((input) => input.error))).toBeLessThan(1);
    if (browserName === 'chromium') {
      expect(fps).toBeGreaterThanOrEqual(55);
      expect(sustained.fps).toBeGreaterThanOrEqual(55);
    }
    await expect(page.locator('html')).toHaveAttribute(
      'data-glass',
      glassScope === 'off' ? 'off' : 'full',
    );
    await expect(page.locator('[data-swipe-action]:visible')).toHaveCount(0);
    await session?.detach();
  });
}
