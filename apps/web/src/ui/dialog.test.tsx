import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../testing/render';

import { Dialog } from './dialog';

/**
 * A dialog that cannot be dismissed is the whole reason this component takes a
 * flag. The recovery codes sit inside one, and every ordinary way out of a
 * dialog is a way to destroy the only credential an account has.
 */
describe('a dialog that cannot be dismissed', () => {
  function open(dismissable: boolean) {
    const onOpenChange = vi.fn();

    renderWithProviders(
      <Dialog open onOpenChange={onOpenChange} dismissable={dismissable} title="Your codes">
        <p>ten codes</p>
      </Dialog>,
    );

    return onOpenChange;
  }

  it('ignores escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = open(false);

    await user.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('ten codes')).toBeInTheDocument();
  });

  it('ignores a press outside it', () => {
    const onOpenChange = open(false);

    // `fireEvent` rather than `user.click`: a modal dialog takes pointer
    // events away from the page behind it, so user-event refuses to click
    // there at all. That refusal is the first barrier. This dispatches the
    // event anyway, to prove the second one.
    fireEvent.pointerDown(document.body, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(document.body, { button: 0, ctrlKey: false });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('ten codes')).toBeInTheDocument();
  });

  it('offers no close button', () => {
    open(false);

    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('an ordinary dialog', () => {
  it('closes on escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithProviders(
      <Dialog open onOpenChange={onOpenChange} title="Change password">
        <p>a form</p>
      </Dialog>,
    );

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('has a close button', () => {
    renderWithProviders(
      <Dialog open onOpenChange={vi.fn()} title="Change password">
        <p>a form</p>
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
