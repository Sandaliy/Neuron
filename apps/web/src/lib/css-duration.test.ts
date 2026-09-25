import { expect, test } from 'vitest';

import { cssDuration } from './css-duration';

test('CSS motion tokens retain their duration after minification', () => {
  expect(cssDuration('900ms', 100)).toBe(900);
  expect(cssDuration('.9s', 100)).toBe(900);
  expect(cssDuration('.34s', 100)).toBe(340);
  expect(cssDuration('', 100)).toBe(100);
});
