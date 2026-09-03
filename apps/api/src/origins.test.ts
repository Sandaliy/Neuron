import { describe, expect, it } from 'vitest';

import {
  buildOrigins,
  isTrustedOrigin,
  matchesOrigin,
  normaliseOrigin,
  originListProblem,
} from './origins.js';

describe('normaliseOrigin', () => {
  it('keeps a scheme, a host and a port', () => {
    expect(normaliseOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('drops a trailing slash', () => {
    expect(normaliseOrigin('https://neuron.example/')).toBe('https://neuron.example');
  });

  it('refuses a url with a path, a query or a fragment', () => {
    expect(normaliseOrigin('https://neuron.example/sign-in')).toBeUndefined();
    expect(normaliseOrigin('https://neuron.example?a=1')).toBeUndefined();
    expect(normaliseOrigin('https://neuron.example#top')).toBeUndefined();
  });

  it('refuses anything that is not http or https', () => {
    // The scheme-less form is the one that matters: the url parser reads
    // "neuron.example:443" as a url whose scheme is "neuron.example".
    expect(normaliseOrigin('neuron.example:443')).toBeUndefined();
    expect(normaliseOrigin('ftp://neuron.example')).toBeUndefined();
    expect(normaliseOrigin('not a url at all')).toBeUndefined();
  });
});

describe('originListProblem', () => {
  it('passes a single origin', () => {
    expect(originListProblem(['https://neuron.example'])).toBeUndefined();
  });

  it('passes a canonical address followed by a pattern', () => {
    expect(
      originListProblem(['https://neuron.example', 'https://neuron-web-git-*-team.vercel.app']),
    ).toBeUndefined();
  });

  it('refuses an empty list', () => {
    expect(originListProblem([])).toMatch(/at least one origin/);
  });

  it('refuses a wildcard in the canonical address', () => {
    expect(originListProblem(['https://*.example'])).toMatch(/canonical address/);
  });

  it('names the entry that is wrong', () => {
    expect(originListProblem(['https://neuron.example', 'nonsense'])).toMatch(/"nonsense"/);
  });
});

describe('matchesOrigin', () => {
  it('compares a plain entry exactly', () => {
    expect(matchesOrigin('https://neuron.example', 'https://neuron.example')).toBe(true);
    expect(matchesOrigin('http://neuron.example', 'https://neuron.example')).toBe(false);
    expect(matchesOrigin('https://neuron.example:8443', 'https://neuron.example')).toBe(false);
  });

  it('lets a wildcard stand for part of a host', () => {
    const pattern = 'https://neuron-web-git-*-parkour-clan.vercel.app';

    expect(matchesOrigin('https://neuron-web-git-main-parkour-clan.vercel.app', pattern)).toBe(
      true,
    );
    expect(matchesOrigin('https://neuron-web-git-fix-auth-parkour-clan.vercel.app', pattern)).toBe(
      true,
    );
  });

  it('does not let a wildcard reach past the host it belongs to', () => {
    const pattern = 'https://neuron-web-git-*-parkour-clan.vercel.app';

    expect(matchesOrigin('https://neuron-web-parkour-clan.vercel.app', pattern)).toBe(false);
    expect(matchesOrigin('https://attacker.example', pattern)).toBe(false);
    // The dot is a literal, not the regular expression's "any character".
    expect(matchesOrigin('https://neuron-web-git-a-parkour-clanXvercel.app', pattern)).toBe(false);
  });

  it('does not let a wildcard swallow a slash and take the host with it', () => {
    expect(
      matchesOrigin(
        'https://attacker.example/https://x-team.vercel.app',
        'https://*-team.vercel.app',
      ),
    ).toBe(false);
  });
});

describe('isTrustedOrigin', () => {
  const origins = buildOrigins([
    'https://neuron.example',
    'https://neuron-web-git-*-parkour-clan.vercel.app',
  ]);

  it('trusts the canonical address', () => {
    expect(isTrustedOrigin(origins, 'https://neuron.example')).toBe(true);
  });

  it('trusts anything the pattern covers', () => {
    expect(isTrustedOrigin(origins, 'https://neuron-web-git-main-parkour-clan.vercel.app')).toBe(
      true,
    );
  });

  it('refuses an alias nobody listed', () => {
    // The exact failure this file exists for: a second alias of the same
    // deployment, which serves the same app and is refused by the api.
    expect(isTrustedOrigin(origins, 'https://neuron-web-six.vercel.app')).toBe(false);
  });

  it('refuses a request with no origin at all', () => {
    expect(isTrustedOrigin(origins, undefined)).toBe(false);
    expect(isTrustedOrigin(origins, '')).toBe(false);
  });
});
