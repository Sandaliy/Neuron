import type { Page } from '@playwright/test';

/**
 * The api, answered from here instead of from a server.
 *
 * A screenshot has to be the same every time it is taken, and a real api gives
 * a different collection, a different account and a different clock on every
 * run. These answers are fixed, so a difference in a screenshot is a difference
 * in the interface.
 *
 * Only the fields the screens actually read. The api validates its own
 * responses on the way out and the client does not re-check them, so a fixture
 * that carried every column would be noise.
 */

export function hostedWindowsSnapshot(name: string, projectName: string): string {
  if (!process.env['CI'] || projectName !== 'phone') return name;

  // GitHub's Windows Server image uses different system font metrics from a
  // desktop Windows installation. Keep both references where text wrapping or
  // monospace rasterisation makes that difference visible.
  return name.replace(/\.png$/, '-ci.png');
}

const ACCOUNT = {
  id: 'user_1',
  name: 'Anna',
  email: 'anna@fastmail.com',
  image: null,
  locale: 'en',
  theme: 'system',
  timezone: 'Europe/Berlin',
  dayCutoffHour: 4,
  plan: 'free',
  settings: {},
  twoFactorEnabled: false,
  revision: 42,
};

function deck(
  id: string,
  name: string,
  due: number,
  fresh: number,
  children: unknown[] = [],
): Record<string, unknown> {
  return {
    id,
    name,
    parentId: null,
    position: 0,
    path: [],
    settings: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 1,
    due,
    fresh,
    children,
  };
}

const DECKS = [
  deck('d1', 'Deutsch', 30, 4, [
    deck('d2', 'Grammatik', 26, 4, [
      deck('d3', 'Verben mit Dativ', 26, 4),
      deck('d4', 'Präpositionen', 0, 0),
    ]),
    deck('d5', 'Wortschatz', 0, 0),
  ]),
  deck('d6', 'Русский', 12, 4, [deck('d7', 'Из книг', 12, 4)]),
];

/** A collection big enough to be worth measuring a scroll on. */
export function manyDecks(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) =>
    deck(`deck_${index}`, `Deck ${index + 1}`, index % 7, index % 3),
  );
}

/**
 * What enrolling in the second factor hands back.
 *
 * A real otpauth uri, because the setup key is pulled back out of it and the QR
 * is drawn from it. A fixed secret, so the picture is the same on every run.
 */
const ENROLLMENT = {
  totpURI:
    'otpauth://totp/Neuron:anna@fastmail.com?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Neuron&digits=6&period=30',
  /*
   * Fifteen characters each, out of the alphabet in `packages/shared`, because
   * the screen puts the hyphens in itself and a code of the wrong length comes
   * out grouped wrongly.
   */
  backupCodes: [
    '4KQPX2M7JWDRT',
    'W9DXH5TALQ2MN',
    'H3RNB8FZQKD4V',
    'PB6YT1CVKR7SW',
    'T2WMJ9JXDHF5C',
    'L7SCG4HRBNP2Z',
    'ZQ8VD6NKTMC3R',
    'D5FAW3PMWJT8H',
    'RX9EK7GYHBV4Q',
    'N6JBP2LQSDW7F',
  ].map((code) => `${code}KM`),
};

export interface FixtureOptions {
  /** Answers `/account` with a session. Off puts the app on the sign in screen. */
  readonly signedIn?: boolean;
  readonly decks?: Record<string, unknown>[];
  /** What the account says about the second factor. Settings draws the state from it. */
  readonly twoFactor?: boolean;
}

/** Answers every api request this app makes, before the page loads. */
export async function useFixtures(page: Page, options: FixtureOptions = {}): Promise<void> {
  const { signedIn = true, decks = DECKS, twoFactor = false } = options;

  /*
   * Matched on the path rather than with a glob. `**` matches slashes, so a
   * glob of `**` `/api/` `**` also catches the module the dev server serves out
   * of `packages/shared/dist/api/`, and the app then loads its own schemas as
   * json.
   */
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const path = new URL(route.request().url()).pathname;

      if (path.endsWith('/api/account')) {
        if (!signedIn) {
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'not_authenticated', correlationId: 'test' },
            }),
          });

          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...ACCOUNT, twoFactorEnabled: twoFactor }),
        });

        return;
      }

      // Registering, so the screen that follows it can be drawn. It answers with
      // the ten codes exactly once, and does not navigate away from them.
      if (path.endsWith('/sign-up/email')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: { id: ACCOUNT.id, email: ACCOUNT.email, name: ACCOUNT.email },
            recoveryCodes: ENROLLMENT.backupCodes,
          }),
        });

        return;
      }

      // A fresh set of account recovery codes, which is the tallest dialog in
      // the app and the one most likely to stop fitting.
      if (path.endsWith('/recovery/regenerate')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ recoveryCodes: ENROLLMENT.backupCodes }),
        });

        return;
      }

      // Enrolling, so the steps after the password can be drawn and measured.
      if (path.endsWith('/two-factor/enable')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(ENROLLMENT),
        });

        return;
      }

      if (path.endsWith('/two-factor/verify-totp')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: true }),
        });

        return;
      }

      if (path.endsWith('/api/decks')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ decks }),
        });

        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    },
  );
}

/**
 * Puts the device preferences in place before the app reads them.
 *
 * They are read out of local storage while the modules are evaluated, which is
 * before React exists, so they have to be written before the page loads rather
 * than clicked afterwards.
 */
export async function usePreferences(
  page: Page,
  preferences: {
    theme?: string;
    locale?: string;
    glass?: string;
    glassScope?: string;
    motion?: string;
  },
): Promise<void> {
  await page.addInitScript(
    (values: Record<string, string>) => {
      for (const [key, value] of Object.entries(values)) {
        // `glassScope` is stored as `neuron.glass-scope`, which is the one key
        // whose name is not the property's name.
        const suffix = key === 'glassScope' ? 'glass-scope' : key;

        window.localStorage.setItem(`neuron.${suffix}`, value);
      }
    },
    preferences as Record<string, string>,
  );
}
