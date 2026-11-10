// Colour maths after tachyonfx: fades and hue shifts on freshly rendered foregrounds.

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
// Terminal named colours need RGB components while an effect is between its endpoints.
const RGB: Record<string, string> = { blue: '#0000ff', green: '#008000', yellow: '#ffff00', magenta: '#ff00ff', red: '#ff0000', cyan: '#00ffff', gray: '#808080', white: '#ffffff', black: '#000000' }
const rgb = (c: string) => hex(RGB[c] ?? c)
const toHex = (channels: number[]) => '#' + channels.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

// tachyonfx fade_to: interpolate freshly rendered foregrounds, never accumulate rounding per frame.
export function fadeColor(from: string, to: string, p: number) {
  if (p <= 0) return from
  if (p >= 1) return to
  const a = rgb(from), b = rgb(to)
  return toHex(a.map((v, i) => v + (b[i] - v) * p))
}

// tachyonfx hsl_shift: convert RGB to HSL, add hue degrees, preserve saturation/lightness.
export function hueShift(c: string, degrees: number) {
  const [r, g, b] = rgb(c).map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  if (!delta) return c
  const light = (max + min) / 2
  const saturation = delta / (1 - Math.abs(2 * light - 1))
  const hue = (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60
  const h = ((hue + degrees) % 360 + 360) % 360 / 60
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation
  const x = chroma * (1 - Math.abs(h % 2 - 1))
  const channels = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x]
  return toHex(channels.map(v => (v + light - chroma / 2) * 255))
}
