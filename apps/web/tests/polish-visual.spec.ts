import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

for (const theme of ['light', 'dark'] as const)
  for (const glass of ['full', 'off'] as const)
    test(`Folder hierarchy preserves shared glass and solid appearance, ${theme}, ${glass}`, async ({
      page,
    }, info) => {
      await usePreferences(page, { locale: 'en', theme, glass, glassScope: 'all' });
      await useFixtures(page);
      await page.goto('/library');
      await page.getByRole('button', { name: 'Show what is inside', exact: true }).first().click();
      await page.getByRole('button', { name: 'Show what is inside', exact: true }).first().click();
      const folder = page.locator('.neu-collection-folder').first();
      const deck = page.locator('.neu-collection-deck').first();
      await expect(folder).toBeVisible();
      await expect(deck).toBeVisible();
      await expect(folder).toHaveCSS('backdrop-filter', 'none');
      await expect(deck).toHaveCSS('backdrop-filter', 'none');
      expect((await folder.boundingBox())!.height).toBeGreaterThan(
        (await deck.boundingBox())!.height,
      );
      const backdrop = page.locator('[data-collection-backdrop]');
      if (glass === 'full') {
        await expect(backdrop).not.toHaveCSS('backdrop-filter', 'none');
        const surfaces = await page.evaluate(() => {
          const folder = getComputedStyle(document.querySelector('.neu-collection-folder')!);
          const deck = getComputedStyle(document.querySelector('.neu-collection-deck')!);
          return {
            folder: folder.backgroundColor,
            deck: deck.backgroundColor,
            edge: folder.boxShadow,
          };
        });
        expect(surfaces.folder).not.toBe(surfaces.deck);
        expect(surfaces.edge).toContain('inset');
      } else await expect(backdrop).toHaveCSS('display', 'none');
      const path = info.outputPath(`library-${theme}-${glass}.png`);
      await page.screenshot({ path, animations: 'disabled', fullPage: true });
      await info.attach('collection-appearance', { path, contentType: 'image/png' });
    });
