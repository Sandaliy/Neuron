import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TypedResponse } from './typed-response';

function Fixture({ reveal }: { reveal: () => void }) {
  const [value, onChange] = useState('');
  const [ready, onReadyChange] = useState(true);
  const [revealed, setRevealed] = useState(false);
  return (
    <TypedResponse
      value={value}
      onChange={onChange}
      ready={ready}
      onReadyChange={onReadyChange}
      answer="Sorgfalt"
      language="de"
      revealed={revealed}
      onReveal={() => {
        reveal();
        setRevealed(true);
      }}
    />
  );
}

describe('typed response submission', () => {
  for (const path of ['Enter', 'button', 'beforeinput', 'textInput', 'blur then submit']) {
    it(`captures the exact draft once through ${path}`, () => {
      const reveal = vi.fn();
      render(<Fixture reveal={reveal} />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Sorgfaltx' } });
      if (path === 'Enter') fireEvent.keyDown(input, { key: 'Enter' });
      if (path === 'button') fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
      if (path === 'beforeinput')
        fireEvent(
          input,
          new InputEvent('beforeinput', {
            inputType: 'insertLineBreak',
            bubbles: true,
            cancelable: true,
          }),
        );
      if (path === 'textInput')
        fireEvent(
          input,
          new InputEvent('textInput', { data: '\n', bubbles: true, cancelable: true }),
        );
      if (path === 'blur then submit') {
        fireEvent.blur(input);
        expect(input).toBeInTheDocument();
        fireEvent.submit(input.closest('form')!);
      }
      expect(reveal).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText(/^Your answer: Sorgfaltx\./)).toBeVisible();
      fireEvent.submit(document.querySelector('form')!);
      expect(reveal).toHaveBeenCalledTimes(1);
    });
  }
  it('preserves a non-empty draft through blur and ignores empty or composing Return', () => {
    const reveal = vi.fn();
    render(<Fixture reveal={reveal} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(reveal).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Sorg' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(reveal).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.blur(input);
    expect(screen.getByRole('button', { name: 'Type your answer' })).toHaveTextContent('Sorg');
    fireEvent.click(screen.getByRole('button', { name: 'Type your answer' }));
    expect(screen.getByRole('textbox')).toHaveValue('Sorg');
    expect(reveal).not.toHaveBeenCalled();
  });
  it('captures the current native value even before a change callback has published it', () => {
    const reveal = vi.fn();
    render(<Fixture reveal={reveal} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.focus();
    input.value = 'Sorgfaltx';
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Your answer: Sorgfaltx\./)).toBeVisible();
  });
});
