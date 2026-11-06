// Robert Penner easing equations, adapted to normalized time.
// Copyright (c) 2001 Robert Penner. MIT; see CREDITS.md.
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))
export const easeInOutCubic = (t: number) => {
  const p = clamp01(t)
  return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2
}
export const easeOutCirc = (t: number) => Math.sqrt(1 - (clamp01(t) - 1) ** 2)
