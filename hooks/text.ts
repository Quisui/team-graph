// Text helpers shared by every renderer: terminal cell widths, clipping and untrusted-text cleanup.

// ponytail: code-point widths; use grapheme segmentation if combining sequences need exact layout.
export const displayWidth = (s: string) => [...s].reduce((w, ch) => {
  const c = ch.codePointAt(0)!
  return w + (/\p{Emoji_Presentation}/u.test(ch) || c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a ||
    (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe10 && c <= 0xfe6f) ||
    (c >= 0xff01 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f000 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)) ? 2 : 1)
}, 0)

export const clip = (s: string, n: number) => {
  if (n <= 0) return ''
  if (displayWidth(s) <= n) return s
  let out = ''
  let width = 0
  for (const ch of s) {
    width += displayWidth(ch)
    if (width > n - 1) break
    out += ch
  }
  return out + '…'
}

export const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - displayWidth(s)))

// Text from messages, logs and panes is untrusted: drop ANSI/OSC escapes and other control characters.
export const clean = (s: string) =>
  String(s).replace(/\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

// Names are drawn with a capital first letter; the stored name stays as is (matching relies on it).
export const cap = (name: string) => (name ? name.charAt(0).toUpperCase() + name.slice(1) : name)

export const secs = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000))
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m${String(t % 60).padStart(2, '0')}s`
}

// `01:24`, or `1:02:03` past an hour: the neon theme's clock format.
export const clock = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000))
  const mm = String(Math.floor(t / 60) % 60).padStart(2, '0'), ss = String(t % 60).padStart(2, '0')
  return t >= 3600 ? `${Math.floor(t / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
}

export const tokensText = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k tok` : `${n} tok`

// One run of styled text in a drawn row: colour, bold, dim.
export type Seg = { t: string; c?: string; b?: boolean; d?: boolean }
