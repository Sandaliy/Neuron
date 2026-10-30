/**
 * Work that needs nothing more from anyone: delivered, resolved, or archived
 * after the server had already acknowledged it. Settled records stay on the
 * device; Offline & sync does not list them.
 */
export const workIsSettled = (entry: { state: string; acknowledgement?: unknown }) =>
  ['synchronized', 'resolved'].includes(entry.state) ||
  (entry.state === 'archived' && entry.acknowledgement !== undefined);
