/** Temporary interaction feedback must end before a route leaves. */
export const NAVIGATION_EVENT = 'neuron:navigate';

export function resetInteractions(): void {
  document.querySelectorAll('[data-pressed]').forEach((element) => {
    element.removeAttribute('data-pressed');
  });
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/**
 * How the last focus arrived, as `data-modality` on the html element.
 *
 * Browsers decide `:focus-visible` per element type, not per input. Safari
 * on iOS treats a tapped `<select>` as keyboard-capable, so after its picker
 * closed the field kept a full accent ring and halo, and stayed that way until
 * something else took focus. The stylesheet drops the ring on controls that
 * were reached by pointer and keeps it for every keyboard arrival.
 */
export function trackModality(): void {
  const root = document.documentElement;
  const set = (modality: 'pointer' | 'keyboard') => {
    if (root.dataset['modality'] !== modality) root.dataset['modality'] = modality;
  };
  document.addEventListener('pointerdown', () => set('pointer'), { capture: true, passive: true });
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) set('keyboard');
    },
    { capture: true, passive: true },
  );
}

export function trackPresses(): void {
  const clear = () =>
    document.querySelectorAll('[data-pressed]').forEach((element) => {
      element.removeAttribute('data-pressed');
    });
  document.addEventListener(
    'pointerdown',
    (event) => {
      clear();
      if (event.pointerType === 'mouse' || !(event.target instanceof Element)) return;
      event.target.closest('button, [data-row], [data-tab]')?.setAttribute('data-pressed', '');
    },
    { passive: true },
  );
  document.addEventListener('pointerup', clear, { passive: true });
  document.addEventListener('pointercancel', clear, { passive: true });
  document.addEventListener('scroll', clear, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clear();
      window.dispatchEvent(new Event(NAVIGATION_EVENT));
    }
  });
  window.addEventListener('pagehide', resetInteractions);
  window.addEventListener('pageshow', resetInteractions);
}
