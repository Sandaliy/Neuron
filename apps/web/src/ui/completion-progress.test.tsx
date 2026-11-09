import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CompletionProgress, cubicBezier } from './completion-progress';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('../preferences/motion', () => ({ motionIsReduced: () => motion.reduced }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  motion.reduced = false;
});

it('draws and counts toward the result while exposing the final accessible result immediately', () => {
  let tick!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const start = performance.now();
  render(<CompletionProgress value={3} max={4} label="Known" />);
  expect(screen.getByRole('img', { name: 'Known: 75%' })).toBeVisible();
  expect(screen.getByText('0%')).toBeVisible();
  // The first frame sets the clock; the count waits for the panel's entrance.
  act(() => tick(start));
  act(() => tick(start + 150));
  expect(screen.getByText('0%')).toBeVisible();
  act(() => tick(start + 160 + 400));
  const middle = Number(screen.getByRole('img').textContent?.replace('%', ''));
  expect(middle).toBeGreaterThan(0);
  expect(middle).toBeLessThan(75);
  act(() => tick(start + 2000));
  expect(screen.getByText('75%')).toBeVisible();
  expect(document.querySelectorAll('circle')[1]).toHaveAttribute('stroke-dashoffset', '0.25');
});
it('renders the final percentage immediately under reduced motion', () => {
  motion.reduced = true;
  render(<CompletionProgress value={1} max={2} label="Known" />);
  expect(screen.getByText('50%')).toBeVisible();
  expect(document.querySelectorAll('circle')[1]).toHaveAttribute('stroke-dashoffset', '0.5');
});

it('follows a css cubic-bezier from rest to rest without overshooting', () => {
  const curve = cubicBezier('cubic-bezier(0.5, 0, 0.2, 1)');
  const samples = Array.from({ length: 101 }, (_, step) => curve(step / 100));
  expect(samples[0]).toBe(0);
  expect(samples[100]).toBe(1);
  for (let step = 1; step < samples.length; step++)
    expect(samples[step]!).toBeGreaterThanOrEqual(samples[step - 1]!);
  // A slow start: the first tenth of the time covers little of the distance.
  expect(curve(0.1)).toBeLessThan(0.05);
  expect(cubicBezier('not a curve')(0.5)).toBeCloseTo(curve(0.5));
});
