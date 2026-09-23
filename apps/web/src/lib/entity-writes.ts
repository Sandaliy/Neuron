import type { QueryClient } from '@tanstack/react-query';

const queues = new WeakMap<QueryClient, Map<string, Promise<unknown>>>();

/** Serialize overlapping entities, without making unrelated notes wait. */
export function writeEntities<T>(
  client: QueryClient,
  ids: readonly string[],
  write: () => Promise<T>,
): Promise<T> {
  let queue = queues.get(client);
  if (!queue) {
    queue = new Map();
    queues.set(client, queue);
  }
  const dependencies = [...new Set(ids.flatMap((id) => queue!.get(id) ?? []))];
  const result = Promise.allSettled(dependencies).then(write);
  for (const id of ids) queue.set(id, result);
  void result
    .finally(() => {
      for (const id of ids) if (queue!.get(id) === result) queue!.delete(id);
    })
    .catch(() => undefined);
  return result;
}
