import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CompletionProgress } from './completion-progress';

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
  act(() => tick(start + 150));
  const middle = Number(screen.getByRole('img').textContent?.replace('%', ''));
  expect(middle).toBeGreaterThan(0);
  expect(middle).toBeLessThan(75);
  act(() => tick(start + 1000));
  expect(screen.getByText('75%')).toBeVisible();
  expect(document.querySelectorAll('circle')[1]).toHaveAttribute('stroke-dashoffset', '0.25');
});
it('renders the final percentage immediately under reduced motion', () => {
  motion.reduced = true;
  render(<CompletionProgress value={1} max={2} label="Known" />);
  expect(screen.getByText('50%')).toBeVisible();
  expect(document.querySelectorAll('circle')[1]).toHaveAttribute('stroke-dashoffset', '0.5');
});
