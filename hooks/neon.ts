// Neon and pulse theme layout: header, session progress, the graph in a frame and the event stream.
// The graph itself comes from drawGraph; this module only arranges what surrounds it.
import type { Msg, Node } from '../types'
import { fadeColor } from './color'
import { arrive, glow, gradient, shimmer, spinnerFrame } from './pulse'
import { isDone, isFailed, kindOf, LEAD } from './status'
import type { Kind } from './status'
import { layoutOf, NEON, toneOf } from './themes'
import { clean, clip, clock, displayWidth, pad, tokensText } from './text'
import type { Seg } from './text'

export const NEON_GRAPH_MIN = layoutOf('neon').minRows
const CARD_MIN = 18

// Room for every card at a readable width; otherwise the agents are drawn as a list.
export const neonFits = (W: number, agents: number) =>
  W >= 56 && Math.floor((W - 4) / Math.max(1, Math.ceil(agents / 2))) >= CARD_MIN

const GLYPH: Partial<Record<Kind, string>> = { failed: '✗', waiting: '⚑', pending: '○', done: '✓' }
const LABEL: Record<Kind, string> = { failed: '', waiting: 'NEEDS YOU', pending: 'PENDING', done: 'DONE', running: 'RUNNING', idle: 'RUNNING' }

export function neonState(n: Node, now: number, spin: string) {
  const kind = kindOf(n), done = isDone(n)
  return {
    glyph: GLYPH[kind] ?? spin,
    label: kind === 'failed' ? n.status.toUpperCase() : LABEL[kind],
    metric: done && n.tokens ? tokensText(n.tokens) : n.since != null ? clock((done ? n.ended ?? now : now) - n.since) : '',
    color: toneOf(NEON, n),
  }
}

const width = (segs: Seg[]) => segs.reduce((w, s) => w + displayWidth(s.t), 0)

// Left and right groups on one row; the right one drops when both do not fit.
function spread(left: Seg[], right: Seg[], W: number): Seg[] {
  const room = W - width(left) - width(right)
  if (room >= 1) return [...left, { t: ' '.repeat(room) }, ...right]
  return [{ ...left[0], t: clip(left.map(s => s.t).join(''), W) }]
}

// Clip a row of segments to W cells and pad it to exactly W.
function fit(segs: Seg[], W: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const s of segs) {
    if (used >= W) break
    const t = displayWidth(s.t) <= W - used ? s.t : clip(s.t, W - used)
    out.push({ ...s, t })
    used += displayWidth(t)
  }
  return used < W ? [...out, { t: ' '.repeat(W - used) }] : out
}

// A rounded panel: title on the top border, a note on its right, each body row inside `│ … │`.
function frame(title: Seg[], note: Seg[], body: Seg[][], W: number): Seg[][] {
  const line = NEON.panel
  if (W < 12) return [fit(title, W), ...body.map(r => fit(r, W))]
  // `╭─ ` title ` ──── ` note ` ─╮`; the note goes first when the border runs out of room
  const room = (n: Seg[]) => W - 6 - width(title) - 1 - (n.length ? width(n) + 1 : 0)
  const shown = room(note) >= 1 ? note : []
  const top: Seg[] = [{ t: '╭─ ', c: line }, ...title, { t: ' ' + '─'.repeat(Math.max(1, room(shown))) + (shown.length ? ' ' : ''), c: line }, ...shown, { t: ' ─╮', c: line }]
  return [
    fit(top, W),
    ...body.map(r => [{ t: '│ ', c: line }, ...fit(r, W - 4), { t: ' │', c: line }]),
    [{ t: '╰' + '─'.repeat(W - 2) + '╯', c: line }],
  ]
}

// fx: pulse's motion, on only while motion is allowed
type Fx = { on: boolean; tick: number }

function header(list: Node[], W: number, now: number, theme: string, fx: Fx): Seg[][] {
  const active = list.filter(n => !isDone(n) && n.status === 'running').length
  const done = list.filter(isDone).length
  // elapsed time of the current burst of work, as the bus shows it: since the earliest unfinished agent started
  const open = list.filter(n => !isDone(n))
  const since = Math.min(...open.map(n => n.since ?? now), now)
  const name = ` / ${theme.toUpperCase()}`
  const brand: Seg[] = fx.on
    ? gradient('◆ TEAM GRAPH' + name, [NEON.cyan, NEON.violet, NEON.magenta, NEON.cyan], now / 1200, true)
    : [{ t: '◆ TEAM GRAPH', c: NEON.cyan, b: true }, { t: name, c: NEON.magenta, b: true }]
  const counts: Seg[] = [
    { t: `${fx.on && active ? spinnerFrame('arc', Math.floor(now / 100)) : '●'} ${active} ACTIVE`, c: NEON.done },
    { t: `  ◆ ${done}/${list.length} DONE`, c: NEON.magenta },
    ...(open.length ? [{ t: `  ⏱ ${clock(now - since)}`, c: NEON.muted }] : []),
  ]
  const pct = list.length ? (done / list.length) * 100 : 0
  const filled = Math.round((pct / 100) * W)
  return ([
    spread(brand, counts, W),
    ...(W >= 40 ? [[{ t: clip('AGENT ORCHESTRATION MONITOR', W), c: NEON.muted }]] : []),
    [{ t: '' }],
    spread([{ t: 'SESSION PROGRESS ', c: NEON.muted }, { t: `${pct.toFixed(1)}%`, b: true }], [{ t: `${list.length} NODES CONNECTED`, c: NEON.magenta }], W),
    // violet→magenta across the done share, the panel colour for the rest
    [...(fx.on ? (s: Seg[]) => shimmer(s, now) : (s: Seg[]) => s)(Array.from({ length: filled }, (_, i) => ({ t: '━', c: fadeColor(NEON.violet, NEON.magenta, filled > 1 ? Math.min(0.9999, i / (filled - 1)) : 0) }))),
      { t: '━'.repeat(W - filled), c: NEON.panel }],
  ] as Seg[][]).map(r => fit(r, W))
}

// One row per agent, for panes too narrow (or teams too large) for cards.
function agentList(list: Node[], W: number, now: number, rows: number, spin: string): Seg[][] {
  if (!list.length) return [[{ t: clip('No agents yet · They appear when work is delegated', W), c: NEON.muted }]]
  const shown = list.length > rows ? list.slice(0, Math.max(1, rows - 1)) : list
  const out = shown.map(n => {
    const s = neonState(n, now, spin)
    const right: Seg[] = W >= 36 ? [{ t: s.label, c: s.color, b: true }, ...(s.metric ? [{ t: ' ' + s.metric, c: NEON.muted }] : [])] : []
    const nameW = Math.min(24, Math.max(6, Math.floor(W / 3)))
    const task = W >= 48 ? clip(clean(n.reason ?? n.last ?? ''), Math.max(0, W - nameW - width(right) - 5)) : ''
    return spread([{ t: `${s.glyph} `, c: s.color, b: true }, { t: pad(clip(n.name, nameW), nameW), b: true }, { t: task ? ' ' + task : '', c: NEON.log }], right, W)
  })
  return list.length > shown.length ? [...out, [{ t: `+${list.length - shown.length} more`, c: NEON.muted }]] : out
}

// Icon and colour for one message: a hand-off out of the lead, an agent's final word, or plain traffic.
function eventOf(m: Msg, i: number, msgs: Msg[], list: Node[]) {
  const sender = list.find(n => n.name === m.from)
  const last = msgs.findLastIndex(x => x.from === m.from) === i
  if (LEAD.includes(m.from) || /^task: /.test(m.text)) return { icon: '↗', c: NEON.cyan }
  if (sender && last && isFailed(sender)) return { icon: '✗', c: NEON.fail }
  if (sender && last && isDone(sender)) return { icon: '✓', c: NEON.done }
  return { icon: '›', c: NEON.log }
}

function stream(list: Node[], msgs: Msg[], W: number, lines: number, now: number, fx: Fx): Seg[][] {
  const time = W >= 50
  const stamp = (at?: number): Seg[] => time ? [{ t: at == null ? ' '.repeat(10) : new Date(at).toTimeString().slice(0, 8) + '  ', c: NEON.muted }] : []
  const name = (who: string) => LEAD.includes(who) ? 'Main' : who
  // open permission dialogs are live state, not messages: they lead the stream while they last
  const asks: Seg[][] = list.filter(n => n.waiting && !isDone(n)).map(n => [
    ...stamp(), { t: '⚑ ', c: NEON.ask }, { t: n.name, b: true }, { t: ' requires permission', c: NEON.ask }])
  // an agent that ended without a word of its own (killed, or a team member) still shows how it ended
  const ended = list.filter(n => isDone(n) && n.ended != null && !msgs.some(m => m.from === n.name)).map(n => {
    const c = isFailed(n) ? NEON.fail : NEON.done
    return { at: n.ended!, row: [...stamp(n.ended), { t: isFailed(n) ? '✗ ' : '✓ ', c, b: true }, { t: n.name, b: true }, { t: ' ' + (n.status === 'completed' ? 'finished' : n.status), c }] }
  })
  const said = msgs.map((m, i) => {
    const e = eventOf(m, i, msgs, list)
    // pulse: a new line arrives white and settles into its colour
    const tint = (c: string) => fx.on ? arrive(c, now - m.at) : c
    return { at: m.at, row: [
      ...stamp(m.at),
      { t: e.icon + ' ', c: tint(e.c), b: true },
      { t: name(m.from), b: true }, { t: ' → ', c: NEON.muted }, { t: name(m.to), b: true },
      { t: ' ' + clean(m.text).replace(/\s+/g, ' '), c: tint(e.c === NEON.log ? NEON.muted : e.c) },
    ] }
  })
  const events = [...said, ...ended].sort((x, y) => x.at - y.at)
  const room = Math.max(0, lines - asks.length)
  // newest first, under any open asks
  const all = [...asks.slice(0, lines), ...events.slice(events.length - room).reverse().map(e => e.row)]
  return all.length ? all : [[{ t: 'No messages yet', c: NEON.muted }]]
}

export type NeonView = {
  list: Node[]; msgs: Msg[]; W: number; now: number; count: number
  // the bus title's usage tail (` · 12k tok · $0.86 · limit 24%`), only what the session reports
  extra: string
  // drawGraph's rows at W - 4 columns, or undefined to list the agents instead
  graph?: Seg[][]
  listRows: number; busLines: number; live: boolean; spin: string
  // the theme's name for the header, and whether pulse's motion runs this frame
  theme?: string; fx?: boolean; tick?: number
}

export function drawNeon(v: NeonView): Seg[][] {
  const { list, msgs, W, now } = v
  const inner = W - 4
  const fx = { on: !!v.fx, tick: v.tick ?? 0 }
  const live: Seg[] = v.live ? [{ t: 'LIVE ', c: NEON.muted }, { t: '●', c: fx.on ? glow(NEON.done, now, 600, 0.7) : NEON.done }] : [{ t: 'STATIC', c: NEON.muted }]
  const topology = v.graph ?? agentList(list, inner, now, v.listRows, v.spin)
  return [
    ...header(list, W, now, v.theme ?? 'neon', fx),
    fit([], W),
    ...frame([{ t: v.graph ? `NETWORK TOPOLOGY${v.live ? ' / LIVE' : ''}` : 'AGENTS', c: NEON.muted }], live, topology, W),
    ...frame([{ t: '▤ EVENT STREAM', c: NEON.cyan, b: true }], [{ t: `${v.count} messages${v.extra}`, c: NEON.muted }], stream(list, msgs, inner, v.busLines, now, fx), W),
  ]
}
