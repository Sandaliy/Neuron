/** Learning shortcuts leave editing, native controls and modal focus to the browser. */
export function learningShortcut(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return false;
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return false;
  return !(
    event.target instanceof Element &&
    event.target.closest(
      'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="checkbox"], [role="switch"]',
    )
  );
}
