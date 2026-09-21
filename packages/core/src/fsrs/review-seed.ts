/** Stable review-id seed shared by online answers and local projections. */
export function seedFromReviewId(id: string): number {
  let seed = 0;

  for (const character of id.replaceAll('-', '')) {
    seed = (Math.imul(seed, 31) + character.charCodeAt(0)) | 0;
  }

  return seed >>> 0;
}
