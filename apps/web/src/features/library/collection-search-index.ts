import type { DeckNode } from '@neuron/shared';

export interface CollectionMatch {
  readonly id: string;
  readonly name: string;
  readonly kind: 'folder' | 'deck';
  readonly location: string;
  readonly pending: boolean;
  readonly term: string;
}

export const collectionTerm = (value: string) => value.normalize('NFKC').toLowerCase().trim();

/** One preorder pass per tree revision. Searching never walks or changes the tree. */
export function indexCollections(tree: readonly DeckNode[]): CollectionMatch[] {
  const rows: CollectionMatch[] = [];
  function visit(nodes: readonly DeckNode[], ancestors: readonly string[]) {
    for (const node of nodes) {
      rows.push({
        id: node.id,
        name: node.name,
        kind: node.kind,
        location: ancestors.join(' / '),
        pending: node.rev === 0,
        term: collectionTerm(node.name),
      });
      visit(node.children, [...ancestors, node.name]);
    }
  }
  visit(tree, []);
  return rows;
}

export function searchCollections(index: readonly CollectionMatch[], query: string) {
  const term = collectionTerm(query);
  return term ? index.filter((row) => row.term.includes(term)) : index;
}
