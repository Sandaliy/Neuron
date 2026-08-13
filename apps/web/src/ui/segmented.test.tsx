import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../testing/render';

import { Segmented } from './segmented';

/**
 * The control the theme and the language switches are built from. If it does
 * not work, neither of the two things somebody is most likely to change works.
 */
const OPTIONS = [
  { value: 'system', label: 'Follow the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

function setup(value: 'system' | 'light' | 'dark' = 'system') {
  const onChange = vi.fn();

  renderWithProviders(
    <Segmented label="Theme" value={value} onChange={onChange} options={OPTIONS} />,
  );

  return onChange;
}

describe('the segmented control', () => {
  it('reports which option is chosen', () => {
    setup('light');

    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
  });

  it('answers a tap on the label, which is the whole option', async () => {
    const user = userEvent.setup();
    const onChange = setup();

    // The label rather than the input: the input is off screen, and the label
    // is the 44 px target a thumb actually lands on.
    await user.click(screen.getByText('Dark'));

    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('moves between options with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = setup();

    await user.tab();
    await user.keyboard('{ArrowRight}');

    // Native radios, so this is the browser's own behaviour rather than an
    // imitation of it. Worth a test because hiding the input is what would
    // break it.
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('is one group as far as assistive software is concerned', () => {
    setup();

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(OPTIONS.length);
  });
});
