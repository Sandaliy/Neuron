import { Folder, Layers } from 'lucide-react';

/** The same identity in the Library and its compact selection surfaces. */
export function CollectionIcon({ kind }: { readonly kind: 'folder' | 'deck' }) {
  const Icon = kind === 'folder' ? Folder : Layers;
  return (
    <span
      className={`flex size-32 shrink-0 items-center justify-center rounded-8 ${kind === 'folder' ? 'bg-fill-neutral text-primary' : 'text-secondary'}`}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}

/** Opaque surfaces keep nested hierarchies legible at every glass setting. */
export const collectionSurface = 'neu-collection-surface rounded-18 bg-card';
