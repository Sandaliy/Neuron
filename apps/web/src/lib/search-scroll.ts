/** Keep a focused search above a stable document floor while results shrink. */
export function keepSearchScroll(): () => void {
  const root = document.documentElement;
  const previous = root.style.minHeight;
  let floor = 0;
  const preserve = () => {
    const bottom = Math.ceil(window.scrollY + window.innerHeight);
    if (bottom <= floor) return;
    floor = bottom;
    root.style.minHeight = `${floor}px`;
  };
  preserve();
  window.addEventListener('scroll', preserve, { passive: true });
  return () => {
    window.removeEventListener('scroll', preserve);
    root.style.minHeight = previous;
  };
}
