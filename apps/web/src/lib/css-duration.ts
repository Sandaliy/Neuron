/** Read a CSS time token as milliseconds, including minified second values. */
export function cssDuration(value: string, fallback: number): number {
  const time = value.trim();
  const amount = Number.parseFloat(time);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  if (time.endsWith('ms')) return amount;
  if (time.endsWith('s')) return amount * 1000;
  return fallback;
}
