// Theme configuration: names, the `--theme` argument and each palette theme's colours.
// `classic` has no palette: it colours each agent from the terminal's named colours.

import type { Node } from '../types'
import { kindOf } from './status'
import type { Kind } from './status'

export const THEMES = ['classic', 'retro', 'neon', 'pulse']

export function themeArg(args: string) {
  const m = /(?:^|\s)(?:--theme[=\s]+|-t\s+)?(\w+)\s*$/.exec(args.trim().toLowerCase())
  return m?.[1] && THEMES.includes(m[1]) ? m[1] : undefined
}

export type Palette = {
  run: string; done: string; fail: string; pend: string; ask: string
  // line: a finished agent's link; link: a working one; art: messages in flight
  line: string; link: string; art: string
  // hdr: orchestrator border; log: body text; head: the robot head's outline
  hdr: string; log: string; head: string
  spin: string
}

// Retro, after the C2MS installer's bubbletea dashboard; colours lifted for dark terminals.
// Mid-tones (not near-white) so outline, log text and Codex stay readable on light terminals too.
export const RETRO: Palette = {
  run: '#ffb454', done: '#7ee787', fail: '#ff6b6b', pend: '#8b949e', ask: '#f9e04b',
  line: '#3d4450', link: '#ffb454', art: '#79c0ff',
  hdr: '#a78bfa', log: '#a9b4c0', head: '#c8c2b5',
  spin: '⣾⣽⣻⢿⡿⣟⣯⣷',
}

// Neon, a cyberpunk terminal: cyan links, violet orchestrator, status-coloured cards.
const CYAN = '#69E8FF', VIOLET = '#AC74F5', MAGENTA = '#ED75E5', MUTED = '#758499', PANEL = '#2A3A4F', AMBER = '#FFCA73'
export const NEON: Palette & { cyan: string; violet: string; magenta: string; muted: string; panel: string } = {
  run: AMBER, done: '#62EDAA', fail: '#FF6B6B', pend: MUTED, ask: MAGENTA,
  line: PANEL, link: CYAN, art: AMBER,
  hdr: VIOLET, log: '#A9B6C8', head: VIOLET,
  spin: RETRO.spin,
  cyan: CYAN, violet: VIOLET, magenta: MAGENTA, muted: MUTED, panel: PANEL,
}

// The palette colour for each box state.
const TONE: Record<Kind, keyof Palette> = { failed: 'fail', waiting: 'ask', pending: 'pend', done: 'done', running: 'run', idle: 'pend' }
export const toneOf = (pal: Palette, n: Node) => pal[TONE[kindOf(n)]]

// Layout values that differ per theme, so drawing code reads them instead of testing the theme name.
export type Layout = {
  cardMax: number; cardRows: number; upper: boolean; activeWord: string
  // pending agents' links stay muted until they start
  mutePending: boolean
  minRows: number; resizeLabel: string; resizeFill: string
  // stacked: the neon dashboard (header, framed graph, event stream); fx: pulse's extra motion
  stacked: boolean; fx: boolean
}
const BASE: Layout = { cardMax: 64, cardRows: 1, upper: false, activeWord: 'running', mutePending: false, minRows: 11, resizeLabel: 'k ▲ resize ▼ j', resizeFill: '─', stacked: false, fx: false }
// neon cards hold the task and a status line; two card rows round the head need 15 rows
const NEON_LAYOUT: Layout = { cardMax: 34, cardRows: 2, upper: true, activeWord: 'active', mutePending: true, minRows: 15, resizeLabel: '[k] ▲ RESIZE ▼ [j]', resizeFill: ' ', stacked: true, fx: false }
// pulse is neon with spinners, gradients and glow
const PULSE_LAYOUT: Layout = { ...NEON_LAYOUT, fx: true }
export const layoutOf = (look: string) => look === 'pulse' ? PULSE_LAYOUT : look === 'neon' ? NEON_LAYOUT : BASE

// `c2ms` is the retro theme's old name, still found in saved state; any other unknown value always drew as classic.
export const lookOf = (saved: string) => saved === 'c2ms' ? 'retro' : THEMES.includes(saved) ? saved : 'classic'
export const paletteOf = (look: string): Palette | undefined => look === 'retro' ? RETRO : look === 'neon' || look === 'pulse' ? NEON : undefined
