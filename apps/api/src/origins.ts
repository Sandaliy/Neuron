/**
 * Which addresses this deployment answers to.
 *
 * One string, parsed once, used by four things that would otherwise each keep
 * their own copy: the trusted origin check inside Better Auth, the CORS
 * headers, the links that go into an email, and the description the api
 * generates. When those four disagree the symptom is a sign in that fails with
 * nothing on screen to say why, so they are all built from here.
 */

/** The addresses one deployment answers to. */
export interface Origins {
  /**
   * The one address to give somebody.
   *
   * Session cookies are set for it, reset links point at it, and it is what
   * belongs in a bookmark. Never a pattern: a cookie cannot be issued for a
   * wildcard and neither can a link.
   */
  readonly canonical: string;
  /**
   * Every origin allowed to make a request, the canonical one first.
   *
   * An entry after the first may contain `*`, which stands for any run of
   * characters that is not a slash. That is how every preview deployment is
   * trusted without adding a hostname per branch, which is the habit this
   * whole file exists to prevent.
   */
  readonly trusted: readonly string[];
}

/** Characters that mean something else inside a regular expression. */
const SPECIAL = /[.+?^${}()|[\]\\]/g;

/**
 * An origin with nothing on the end of it.
 *
 * `new URL` is the only reliable way to tell `https://example.com` from
 * `https://example.com/app`, and it is also what drops a trailing slash. An
 * Origin header never carries one, so an entry that does would silently match
 * nothing.
 *
 * @param entry one entry from the list
 * @returns the origin, or undefined when the entry is not a plain origin
 */
export function normaliseOrigin(entry: string): string | undefined {
  let url: URL;

  try {
    url = new URL(entry);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }

  // A path, a query or a fragment means somebody pasted the address of a page
  // rather than the address of the app. It would match nothing, so it is
  // refused at startup instead.
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
    return undefined;
  }

  return url.origin;
}

/**
 * A pattern entry, kept as written.
 *
 * `new URL` cannot be trusted with a `*` in the host, so a pattern is checked
 * by shape instead: a scheme, then a host that carries no slash.
 *
 * @param entry one entry from the list
 * @returns the pattern, or undefined when it is not one
 */
function normalisePattern(entry: string): string | undefined {
  const match = /^(https?:\/\/)([^/?#]+)$/.exec(entry);

  return match ? entry : undefined;
}

/**
 * What is wrong with a list of origins, in a sentence naming the fix.
 *
 * @param entries the list, already split and trimmed
 * @returns the problem, or undefined when there is none
 */
export function originListProblem(entries: readonly string[]): string | undefined {
  const example = 'https://neuron.example';

  if (entries.length === 0) {
    return `must name at least one origin, for example ${example}`;
  }

  const [canonical, ...rest] = entries;

  if (canonical === undefined || canonical.includes('*')) {
    return `starts with the canonical address, which is one real origin and cannot contain *, for example ${example}`;
  }

  if (normaliseOrigin(canonical) === undefined) {
    return `starts with the canonical address, which is a scheme and a host and nothing else, for example ${example}`;
  }

  for (const entry of rest) {
    if (normaliseOrigin(entry) === undefined && normalisePattern(entry) === undefined) {
      return `lists "${entry}", which is not an origin. Entries are separated by commas and each one is a scheme and a host, for example ${example}, optionally with * standing for part of the host`;
    }
  }

  return undefined;
}

/**
 * Builds the parsed form. Call `originListProblem` first: this assumes it passed.
 *
 * @param entries the list, already split and trimmed
 * @returns the canonical address and everything trusted
 */
export function buildOrigins(entries: readonly string[]): Origins {
  return {
    canonical: normaliseOrigin(entries[0] as string) as string,
    trusted: entries.map((entry) => normaliseOrigin(entry) ?? entry),
  };
}

/**
 * Whether one origin matches one entry.
 *
 * `*` stands for any run of characters that is not a slash, which is the same
 * thing it stands for inside Better Auth. Both have to agree or a request
 * would pass the CORS check and then be refused by the origin check, which
 * reads as the api being broken rather than as a configuration mistake.
 *
 * @param origin the Origin header, exactly as it arrived
 * @param entry one entry from the trusted list
 * @returns whether the request may proceed
 */
export function matchesOrigin(origin: string, entry: string): boolean {
  if (!entry.includes('*')) {
    return entry === origin;
  }

  const expression = new RegExp(
    `^${entry
      .split('*')
      .map((part) => part.replace(SPECIAL, '\\$&'))
      .join('[^/]*')}$`,
  );

  return expression.test(origin);
}

/**
 * Whether an origin is on the list at all.
 *
 * @param origins the parsed list
 * @param origin the Origin header, or undefined when there is none
 * @returns whether the request may proceed
 */
export function isTrustedOrigin(origins: Origins, origin: string | undefined): boolean {
  if (origin === undefined || origin.length === 0) {
    return false;
  }

  return origins.trusted.some((entry) => matchesOrigin(origin, entry));
}
