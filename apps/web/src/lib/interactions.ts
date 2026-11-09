/** Temporary interaction feedback must end before a route leaves. */
export const NAVIGATION_EVENT = 'neuron:navigate';

/**
 * The app went to the background: another app, the home screen, a lock.
 *
 * Only transient layers listen for it, a menu or a pressed row. A dialog does
 * not: it holds work in progress, and closing it when the person switched apps
 * threw that work away. Setting up two-factor authentication is the case that
 * made this visible. The setup key has to be copied into an authenticator app,
 * and leaving Neuron to do it closed the dialog and lost the key on screen.
 */
export const BACKGROUND_EVENT = 'neuron:background';

function clearPresses(): void {
  document.querySelectorAll('[data-pressed]').forEach((element) => {
    element.removeAttribute('data-pressed');
  });
}

/** A route is about to change: every overlay closes and focus is released. */
export function resetInteractions(): void {
  clearPresses();
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/** The page was hidden or restored. Presses and menus end; dialogs and focus stay. */
export function releaseInteractions(): void {
  clearPresses();
  window.dispatchEvent(new Event(BACKGROUND_EVENT));
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
    if (document.hidden) releaseInteractions();
  });
  window.addEventListener('pagehide', releaseInteractions);
  window.addEventListener('pageshow', releaseInteractions);
}
