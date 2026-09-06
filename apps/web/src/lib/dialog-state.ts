import { useState } from 'react';

/**
 * State that goes back to its starting value each time a dialog opens.
 *
 * A dialog stays mounted while it is closed, so that it can animate on the way
 * out. That means whatever was half typed the last time is still in there, and
 * reopening the rename dialog on a different deck would offer the previous
 * deck's name.
 *
 * Written as a comparison during render rather than as an effect. An effect
 * that sets state runs after the browser has already painted the stale value,
 * which is a visible flash of the wrong name, and it is what
 * `react-hooks/set-state-in-effect` exists to catch. Adjusting state during
 * render is React's own answer to "this state depends on a prop": the component
 * re-runs immediately, before anything is shown.
 *
 * @param open whether the dialog is open
 * @param initial what the value should be each time it opens
 * @returns the value and its setter
 */
export function useDialogState<T>(open: boolean, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState(initial);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);

    if (open) {
      setValue(initial);
    }
  }

  return [value, setValue];
}
