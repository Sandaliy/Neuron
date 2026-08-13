/*
 * Temporary measurement probe. Not part of the product. Enabled with ?probe=1.
 *
 * It installs a minimal React DevTools hook before react-dom is evaluated, so
 * every commit is recorded with the components that actually re-rendered. It
 * also records theme attribute changes, request order and interaction latency.
 */
declare global {
  interface Window {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
    __probe?: Probe;
  }
}

interface Commit {
  readonly at: number;
  readonly components: string[];
}

interface Probe {
  commits: Commit[];
  theme: { at: number; value: string }[];
  lang: { at: number; value: string }[];
  requests: {
    at: number;
    method: string;
    url: string;
    status?: number;
    done?: number;
    body?: string;
  }[];
  interactions: {
    at: number;
    name: string;
    duration: number;
    processing: number;
    presentation: number;
  }[];
  reset: () => void;
  report: () => unknown;
}

const probe: Probe = {
  commits: [],
  theme: [],
  lang: [],
  requests: [],
  interactions: [],
  reset() {
    probe.commits = [];
    probe.theme = [];
    probe.lang = [];
    probe.requests = [];
    probe.interactions = [];
  },
  report() {
    const zero =
      probe.interactions[0]?.at ??
      probe.commits[0]?.at ??
      probe.requests[0]?.at ??
      probe.theme[0]?.at ??
      0;
    const rel = (n: number) => Math.round((n - zero) * 10) / 10;

    return {
      commits: probe.commits.map((c) => ({ at: rel(c.at), components: c.components })),
      commitCount: probe.commits.length,
      componentRenders: probe.commits.reduce((n, c) => n + c.components.length, 0),
      theme: probe.theme.map((t) => ({ at: rel(t.at), value: t.value })),
      lang: probe.lang.map((t) => ({ at: rel(t.at), value: t.value })),
      requests: probe.requests.map((r) => ({
        at: rel(r.at),
        done: r.done === undefined ? undefined : rel(r.done),
        method: r.method,
        url: r.url,
        status: r.status,
        body: r.body,
      })),
      interactions: probe.interactions.map((i) => ({
        at: rel(i.at),
        name: i.name,
        inp: Math.round(i.duration),
        processing: Math.round(i.processing),
        presentation: Math.round(i.presentation),
      })),
    };
  },
};

function nameOf(fiber: {
  type?: unknown;
  elementType?: unknown;
  tag?: number;
}): string | undefined {
  const type = (fiber.elementType ?? fiber.type) as
    { displayName?: string; name?: string; render?: { name?: string } } | string | null | undefined;

  if (typeof type === 'string' || type === null || type === undefined) {
    return undefined;
  }

  return type.displayName ?? type.name ?? type.render?.name ?? undefined;
}

/**
 * One switch, measured end to end.
 *
 * Records the moment the control is changed, the moment the browser has
 * painted the frame that shows it, every React commit that follows, and any
 * long task the change causes. `settleMs` is how long to keep watching after
 * the change, which has to outlast the request the change starts.
 */
async function measureSwitch(selector: string, settleMs = 6000) {
  const target = document.querySelector<HTMLInputElement>(selector);

  if (!target) {
    throw new Error(`no control matches ${selector}`);
  }

  probe.reset();

  const longTasks: { at: number; duration: number }[] = [];
  const tasks = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.push({ at: entry.startTime, duration: entry.duration });
    }
  });

  try {
    tasks.observe({ type: 'longtask', buffered: false });
  } catch {
    /* not supported */
  }

  const started = performance.now();
  let applied = 0;

  const dom = new MutationObserver(() => {
    if (applied === 0) {
      applied = performance.now();
    }
  });

  dom.observe(document.documentElement, { attributes: true });

  target.click();

  // A macrotask, not requestAnimationFrame: rAF only runs while the tab is
  // producing frames, and this has to be measurable in a headless window too.
  await new Promise((resolve) => setTimeout(resolve, 0));
  dom.disconnect();

  await new Promise((resolve) => setTimeout(resolve, settleMs));
  tasks.disconnect();

  const report = probe.report() as { commits: { at: number; components: string[] }[] };
  const rel = (n: number) => Math.round((n - started) * 10) / 10;

  return {
    clickToDomMs: applied === 0 ? undefined : Math.round((applied - started) * 10) / 10,
    commits: report.commits.map((c) => ({ at: c.at, components: c.components.length })),
    commitCount: report.commits.length,
    componentRenders: report.commits.reduce((n, c) => n + c.components.length, 0),
    // The part that arrives after the network, which the person has already
    // stopped looking at.
    lateCommits: report.commits.filter((c) => c.at > 100),
    lateComponentRenders: report.commits
      .filter((c) => c.at > 100)
      .reduce((n, c) => n + c.components.length, 0),
    theme: (probe.report() as { theme: unknown }).theme,
    lang: (probe.report() as { lang: unknown }).lang,
    requests: (probe.report() as { requests: unknown }).requests,
    longTasks: longTasks.map((t) => ({ at: rel(t.at), duration: Math.round(t.duration) })),
  };
}

function install(): void {
  if (!new URLSearchParams(location.search).has('probe')) {
    return;
  }

  window.__probe = probe;
  (probe as unknown as Record<string, unknown>)['measureSwitch'] = measureSwitch;

  const renderers = new Map<number, unknown>();
  let nextId = 1;

  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers,
    isDisabled: false,
    inject(renderer: unknown) {
      const id = nextId++;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id: unknown, root: { current?: unknown }) {
      const components: string[] = [];
      const seen = new Set<unknown>();

      /*
       * Self duration, not total duration.
       *
       * `actualDuration` on a fiber includes everything below it, so a parent
       * that only passed a re-render through still reads above zero. The
       * DevTools profiler subtracts the children to get the time the component
       * itself spent, and only that means "this component re-rendered".
       */
      const walk = (fiber: Record<string, unknown> | null | undefined): number => {
        let subtree = 0;

        while (fiber) {
          if (seen.has(fiber)) break;
          seen.add(fiber);

          const total = (fiber['actualDuration'] as number | undefined) ?? 0;
          const below = walk(fiber['child'] as never);
          const self = total - below;

          if (self > 0) {
            const name = nameOf(fiber as never);
            if (name) components.push(name);
          }

          subtree += total;
          fiber = fiber['sibling'] as never;
        }

        return subtree;
      };

      walk((root.current as never) ?? null);
      probe.commits.push({ at: performance.now(), components });
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  };

  new MutationObserver(() => {
    const value = document.documentElement.dataset['theme'] ?? '?';
    if (probe.theme.at(-1)?.value !== value) {
      probe.theme.push({ at: performance.now(), value });
    }
    const lang = document.documentElement.lang;
    if (probe.lang.at(-1)?.value !== lang) {
      probe.lang.push({ at: performance.now(), value: lang });
    }
  }).observe(document.documentElement, { attributes: true });

  const original = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const entry: (typeof probe.requests)[number] = { at: performance.now(), method, url };
    probe.requests.push(entry);

    const answer = await original(input as never, init);
    entry.done = performance.now();
    entry.status = answer.status;

    try {
      entry.body = (await answer.clone().text()).slice(0, 300);
    } catch {
      /* opaque */
    }

    return answer;
  };

  new PerformanceObserver((list) => {
    for (const raw of list.getEntries()) {
      const e = raw as PerformanceEventTiming & { interactionId?: number };
      if (!e.interactionId) continue;
      probe.interactions.push({
        at: e.startTime,
        name: e.name,
        duration: e.duration,
        processing: e.processingEnd - e.processingStart,
        presentation: e.startTime + e.duration - e.processingEnd,
      });
    }
  }).observe({ type: 'event', durationThreshold: 0, buffered: true } as never);
}

install();

export {};
