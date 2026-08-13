import '@testing-library/jest-dom/vitest';

/**
 * What jsdom does not have, and every component test needs.
 *
 * These are stubs rather than implementations. Nothing in this suite is about
 * how a browser lays out or animates; what is under test is the wiring, and
 * both layout and animation are checked by hand at 375 px instead.
 */

// Radix measures scrollbars and dialogs with this, and the theme reads it to
// decide whether the operating system is asking for a dark interface.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Radix's dialog and select both observe their content.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

// The download button builds one of these around the codes.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:codes';
  URL.revokeObjectURL = () => undefined;
}
