// Pulse theme effects: cli-spinners frames, gradient-string colouring and chalk-animation style motion,
// written as pure functions of time so motion off, NO_MOTION and short panes just pass a still clock.
import { fadeColor } from './color'
import type { Seg } from './text'

// Frames from sindresorhus/cli-spinners (MIT), one cell wide so they fit a card title.
export const SPINNERS = {
  dots: '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏',
  arc: '◜◠◝◞◡◟',
  halves: '◐◓◑◒',
  bounce: '⠁⠂⠄⡀⢀⠠⠐⠈',
}
export type Spinner = keyof typeof SPINNERS

export const spinnerFrame = (name: Spinner, tick: number) => {
  const frames = [...SPINNERS[name]]
  return frames[tick % frames.length]!
}

// The colour at position p (0..1) along evenly spaced stops.
export function along(stops: string[], p: number) {
  const x = Math.min(0.9999, Math.max(0, p)) * (stops.length - 1)
  const i = Math.floor(x)
  return fadeColor(stops[i]!, stops[i + 1] ?? stops[i]!, x - i)
}

// gradient-string: each character takes its place on the gradient; a phase scrolls it like
// chalk-animation's rainbow. Cyclic stops (first = last) keep the scroll seamless.
export function gradient(text: string, stops: string[], phase = 0, b?: boolean): Seg[] {
  const chars = [...text]
  return chars.map((t, i) => ({ t, c: along(stops, ((i / Math.max(1, chars.length)) + phase) % 1), b }))
}

// chalk-animation's pulse: brighten toward white and back, once per period.
export const glow = (c: string, now: number, period = 800, amount = 0.35) =>
  fadeColor(c, '#ffffff', amount * (0.5 + 0.5 * Math.sin((2 * Math.PI * now) / period)))

// chalk-animation's radar: a bright band sweeps across a bar every `period` ms. The band is wide and its
// edge eased (smoothstep), so each cell brightens and dims gradually instead of switching on and off.
export function shimmer(segs: Seg[], now: number, period = 900, band = 8): Seg[] {
  const width = segs.length
  const at = ((now % period) / period) * (width + 2 * band) - band
  return segs.map((s, i) => {
    const x = 1 - Math.abs(i - at) / band
    return x > 0 && s.c ? { ...s, c: fadeColor(s.c, '#ffffff', 0.6 * x * x * (3 - 2 * x)) } : s
  })
}

// A new line arrives white and settles into its colour over `ms`.
export const arrive = (c: string, age: number, ms = 1200) => age >= 0 && age < ms ? fadeColor('#ffffff', c, age / ms) : c
