/** Temporary interaction feedback must end before a route leaves. */
export const NAVIGATION_EVENT = 'neuron:navigate';

export function resetInteractions(): void {
  document.querySelectorAll('[data-pressed]').forEach((element) => {
    element.removeAttribute('data-pressed');
  });
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
