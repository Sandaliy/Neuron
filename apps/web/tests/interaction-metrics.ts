import type { Page } from '@playwright/test';

/** Test-only observation: the same built application and probes are used on both revisions. */
export async function installInteractionMetrics(page: Page) {
  await page.addInitScript(() => {
    const metrics = {
      commits: 0,
      renders: {} as Record<string, number>,
      tasks: [] as number[],
      shifts: [] as number[],
      frames: [] as number[],
      scans: {} as Record<string, number>,
      active: false,
      supported: PerformanceObserver.supportedEntryTypes,
    };
    Object.assign(window, { interactionMetrics: metrics });
    type Fiber = {
      type?: { name?: string };
      flags: number;
      child?: Fiber;
      sibling?: Fiber;
    };
    Object.assign(window, {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        inject: () => 1,
        onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
          if (!metrics.active) return;
          metrics.commits++;
          const visit = (fiber?: Fiber) => {
            if (!fiber) return;
            const name = fiber.type?.name;
            if (name && (fiber.flags & 1) !== 0)
              metrics.renders[name] = (metrics.renders[name] ?? 0) + 1;
            visit(fiber.child);
            visit(fiber.sibling);
          };
          visit(root.current);
        },
        onCommitFiberUnmount: () => undefined,
      },
    });
    for (const type of ['longtask', 'layout-shift']) {
      if (!metrics.supported.includes(type)) continue;
      new PerformanceObserver((list) => {
        if (!metrics.active) return;
        for (const entry of list.getEntries()) {
          if (type === 'longtask') metrics.tasks.push(entry.duration);
          else metrics.shifts.push((entry as PerformanceEntry & { value: number }).value);
        }
      }).observe({ type });
    }
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (metrics.active) metrics.scans[this.name] = (metrics.scans[this.name] ?? 0) + 1;
      return getAll.apply(this, args);
    };
    let previous = 0;
    function frame(time: number) {
      if (metrics.active && previous) metrics.frames.push(time - previous);
      previous = metrics.active ? time : 0;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

export async function startInteractionMetrics(page: Page) {
  await page.evaluate(() => {
    const metrics = (window as unknown as { interactionMetrics: { active: boolean } })
      .interactionMetrics;
    Object.assign(metrics, {
      commits: 0,
      renders: {},
      tasks: [],
      shifts: [],
      frames: [],
      scans: {},
    });
    metrics.active = true;
  });
}

export async function readInteractionMetrics(page: Page) {
  return page.evaluate(() => {
    const metrics = (
      window as unknown as {
        interactionMetrics: {
          active: boolean;
          commits: number;
          renders: Record<string, number>;
          tasks: number[];
          shifts: number[];
          frames: number[];
          scans: Record<string, number>;
          supported: string[];
        };
      }
    ).interactionMetrics;
    metrics.active = false;
    const frames = metrics.frames.toSorted((a, b) => a - b);
    return {
      commits: metrics.commits,
      renderedFibers: Object.values(metrics.renders).reduce((sum, count) => sum + count, 0),
      longTasks: metrics.tasks,
      layoutShift: metrics.shifts.reduce((sum, value) => sum + value, 0),
      frameCount: frames.length,
      fps: frames.length
        ? (1000 * frames.length) / frames.reduce((sum, frame) => sum + frame, 0)
        : 0,
      p95FrameMs: frames[Math.floor(frames.length * 0.95)] ?? 0,
      worstFrameMs: frames.at(-1) ?? 0,
      scans: metrics.scans,
      supported: metrics.supported,
    };
  });
}

/** Observe a real animated interaction for a bounded measurement interval. */
export async function sampleInteraction(page: Page, action: () => Promise<unknown>) {
  await startInteractionMetrics(page);
  await action();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const frame = () => {
          if (performance.now() - start < 450) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      }),
  );
  return readInteractionMetrics(page);
}
