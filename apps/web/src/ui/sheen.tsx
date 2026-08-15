import { useEffect, useRef } from 'react';

/**
 * The specular streak on a glass layer.
 *
 * A short highlight on the top rim that travels as content scrolls underneath.
 * It is the only part of the glass effect that responds to context, and it is
 * what separates a pane of glass from a translucent rectangle.
 *
 * It moves by `transform` and nothing else, it never touches the blur radius,
 * and it is removed from the document entirely when the effect is off, so a
 * phone that turned glass off is not paying for a scroll listener.
 */
export function Sheen() {
  const element = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = element.current;

    if (!node) {
      return;
    }

    const layer = node.parentElement;

    if (!layer) {
      return;
    }

    let frame = 0;

    const place = () => {
      frame = 0;

      const width = layer.offsetWidth;

      if (width === 0) {
        return;
      }

      /*
       * The streak is 38% of the layer, so it has 62% to travel. Tied to how
       * far down the page the person is rather than to time, which is what
       * makes it read as light moving over a surface rather than as an
       * animation somebody started.
       */
      const scrolled = window.scrollY;
      const runway = Math.max(1, document.body.scrollHeight - window.innerHeight);
      const share = Math.min(1, scrolled / runway);

      node.style.transform = `translate3d(${share * width * 0.62}px, 0, 0)`;
    };

    const onScroll = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(place);
      }
    };

    place();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }

      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return <span ref={element} data-sheen="" aria-hidden="true" />;
}
