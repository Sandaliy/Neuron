import { QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

import { writeEntities } from './entity-writes';

it('serializes overlapping writes while unrelated notes proceed, even after failure', async () => {
  const client = new QueryClient();
  let reject!: (reason: Error) => void;
  const first = writeEntities(
    client,
    ['a'],
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const secondWrite = vi.fn(async () => 2);
  const second = writeEntities(client, ['a', 'b'], secondWrite);
  expect(await writeEntities(client, ['c'], async () => 3)).toBe(3);
  expect(secondWrite).not.toHaveBeenCalled();
  const failed = expect(first).rejects.toThrow('refused');
  reject(new Error('refused'));
  await failed;
  expect(await second).toBe(2);
});
