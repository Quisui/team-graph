import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Flight, Msg, Node } from '../types'
import { easeOutCirc, easeInOutCubic } from './easing'

const nodes = atom({ plugin: 'team-graph', key: 'nodes' } as const, [])
const log = atom({ plugin: 'team-graph', key: 'log' } as const, [])
const flights = atom({ plugin: 'team-graph', key: 'flights' } as const, [])
const messageCount = atom({ plugin: 'team-graph', key: 'messageCount' } as const, 0)
const times = atom({ plugin: 'team-graph', key: 'times' } as const, [])
const PANE = 'team-graph'
// open by default on a new session; a /team-graph toggle-off is remembered
const shown = atom({ plugin: 'team-graph', key: 'shown' } as const, true)
const owner = atom({ plugin: 'team-graph', key: 'owner' } as const, { id: '', beat: 0 })
const graphRows = atom({ plugin: 'team-graph', key: 'graphRows' } as const, 0)
const mainLast = atom({ plugin: 'team-graph', key: 'mainLast' } as const, '')
const mainAt = atom({ plugin: 'team-graph', key: 'mainAt' } as const, 0)
const robotStyle = atom({ plugin: 'team-graph', key: 'robotStyle' } as const, 'head')
const theme = atom({ plugin: 'team-graph', key: 'theme' } as const, 'retro')
const frame = atom({ plugin: 'team-graph', key: 'frame' } as const, 0)

const motion = atom({ plugin: 'team-graph', key: 'motion' } as const, true)
const openedAt = atom({ plugin: 'team-graph', key: 'openedAt' } as const, -1)

export const GRAPH_ROWS = 11
const SWEEP_MS = 400
const FADE_MS = 600
const FLIGHT_MS = 1800
const FLASH_MS = 700
const FLIGHT_TTL = FLIGHT_MS + FLASH_MS
const QUIET_TOOLS = ['SubagentHandback', 'SendMessage', 'TaskUpdate', 'TaskCreate', 'TaskList', 'TaskGet', 'ToolSearch']
const CODEX_ANSWER = '[codex] Assistant message captured: '
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const lastCodexAnswer = (raw: string) => raw.split('\n').filter(l => l.startsWith(CODEX_ANSWER)).at(-1)?.slice(CODEX_ANSWER.length)
const PALETTE = ['blue', 'green', 'yellow', 'magenta', 'red', 'cyan']
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const LEAD = ['team-lead', 'orchestrator', 'main', 'lead']

const secs = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000))
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m${String(t % 60).padStart(2, '0')}s`
}
// Messages per 5 s bucket over the last minute, as a sparkline.
export const spark = (times: number[], now: number) => {
  const bars = '▁▂▃▄▅▆▇█'
  const b = Array(12).fill(0)
  for (const t of times) {
    const i = 11 - Math.floor((now - t) / 5000)
    if (i >= 0 && i < 12) b[i]++
  }
  const max = Math.max(1, ...b)
  return b.map(v => (v ? bars[Math.min(7, Math.ceil((v / max) * 7))] : '▁')).join('')
}
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
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - displayWidth(s)))
const isPending = (n: Node) => n.status === 'pending' || n.status === 'idle' && (!n.done || n.since == null && !n.tools && !n.last)
const isDone = (n: Node) => !isPending(n) && (n.done || ['completed', 'failed', 'killed', 'idle'].includes(n.status))
// Agent ids look like `frontend@session-…`; tool.call and agent.list may spell them differently.
const same = (n: Pick<Node, 'id' | 'name'>, id: string) => n.id === id || n.name === id.split('@')[0] || n.id.split('@')[0] === id
const TEAM_COLOR: Record<string, string> = { purple: 'magenta', orange: 'yellow', pink: 'magenta' }
const teamColors: Record<string, string> = {}
const EXTERNAL_COLOR: Record<string, string> = { codex: '#a9b4c0', gemini: 'blue' }
export const colorOf = (list: Node[], name: string) => {
  const provider = list.find(n => n.name === name)?.external
  return provider ? EXTERNAL_COLOR[provider] ?? 'cyan' : LEAD.includes(name) ? 'cyan' :
    teamColors[name] ?? PALETTE[Math.max(0, list.findIndex(n => n.name === name)) % PALETTE.length]
}

type Cell = { ch: string; c?: string; b?: boolean; line?: boolean }
export type Seg = { t: string; c?: string; b?: boolean; d?: boolean }

// Text from messages, logs and panes is untrusted: drop ANSI/OSC escapes and other control characters.
export const clean = (s: string) =>
  String(s).replace(/\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

// Names are drawn with a capital first letter; the stored name stays as is (matching relies on it).
export const cap = (name: string) => (name ? name[0].toUpperCase() + name.slice(1) : name)

export const pretty = (s: string) => {
  const m = /^(\w+)\((.*?)\)?$/.exec(s)
  return shortPaths(m ? `${m[1]} ▸ ${m[2]}` : s)
}
// `/private/tmp/claude-502/-Users-…/tasks/x.output` becomes `…/tasks/x.output`.
export const shortPaths = (s: string) => s.replace(/(?:\/[^\s/'"]+){3,}(\/[^\s/'"]+\/[^\s/'"]+)/g, '…$1')

// Line glyph from which neighbours a cell connects to (up, down, left, right).
const GLYPH: Record<string, string> = {
  ud: '╎', lr: '╌', u: '╎', d: '╎', l: '╌', r: '╌',
  dr: '╭', dl: '╮', ur: '╰', ul: '╯',
  udr: '├', udl: '┤', ulr: '┴', dlr: '┬', udlr: '┼',
}

// Half the agents on a top row, the rest on a bottom row, orchestrator between.
// Each agent joins the orchestrator by a right-angled dashed line; messages travel along it.
// ponytail: two rows only; larger teams need a taller pane to retain long names.
export function drawGraph(list: Node[], W: number, fl: Flight[] = [], now = 0, tick = 0, hasTeam = true, look = 'classic', height = GRAPH_ROWS, effects: { enabled: boolean; opened?: number } = { enabled: false }, style = 'head', main: { last: string; at: number } = { last: '', at: 0 }): Seg[][] {
  const c2 = look === 'retro'
  const narrow = W < 70
  const head = c2 && style === 'head'
  // the head always draws as a box; narrow panes get a 7-column head with eyes one space apart
  const tallHead = head && W >= 40 && height >= 9
  // terminal cells are ~2x taller than wide, so the head is wide to read as a rounded face, not a long one
  const IW = narrow ? 7 : 9
  const HEAD_TOP = '╭' + '─'.repeat(IW) + '╮'
  const HEAD_BOTTOM = '╰' + '─'.repeat(IW) + '╯'
  const gap = narrow ? ' ' : '   '
  const eyeSpan = 2 + gap.length
  const eyeHome = Math.floor((IW - eyeSpan) / 2)
  if (!effects.enabled) tick = 0
  const spin = c2 ? C2.spin : SPIN
  const H = Math.max(7, height)
  const grid: Cell[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => ({ ch: ' ' })))
  const put = (x: number, y: number, s: string, c?: string, b?: boolean) => {
    for (const ch of s) {
      const w = displayWidth(ch)
      if (y >= 0 && y < H && x >= 0 && x + w <= W) {
        grid[y][x] = { ch, c, b }
        if (w === 2) grid[y][x + 1] = { ch: '', c, b }
      }
      x += w
    }
  }
  const soft = (x: number, y: number, s: string, c?: string, b?: boolean) => {
    for (const ch of s) {
      const cell = grid[y]?.[x]
      if (cell && cell.line !== false && (cell.ch === ' ' || cell.line)) grid[y][x] = { ch, c, b, line: true }
      x += displayWidth(ch)
    }
  }
  // title on the left of the top border, status on the right; the body line is all activity
  const box = (cx: number, cy: number, w: number, title: string, status: string, body: string, c: string, bodyC?: string, flash = false, statusC?: string, body2?: string, body3?: string) => {
    const x = Math.max(0, Math.min(W - w, Math.round(cx - w / 2)))
    if (w < 2) return { x, w }
    const [tl, hz, tr, vt, bl, br] = flash ? ['┏', '━', '┓', '┃', '┗', '┛'] : ['╭', '─', '╮', '│', '╰', '╯']
    put(x, cy - 1, tl + hz.repeat(w - 2) + tr, c, flash)
    const reserve = status ? Math.min(displayWidth(status), Math.max(1, Math.floor((w - 6) / 3))) : 0
    title = clip(title, w - 4 - (reserve ? reserve + 2 : 0))
    const statusW = Math.max(reserve, w - 6 - displayWidth(title))
    if (statusW === 1) status = status[0]
    else status = clip(status, statusW)
    put(x + 2, cy - 1, title, c, true)
    if (status) put(x + w - 2 - displayWidth(status), cy - 1, status, statusC ?? bodyC ?? c)
    put(x, cy, vt, c, flash)
    put(x + 2, cy, pad(clip(body, w - 4), w - 4), bodyC, flash)
    put(x + w - 1, cy, vt, c, flash)
    const extra = body3 !== undefined ? 2 : body2 === undefined ? 0 : 1
    if (extra) {
      put(x, cy + 1, vt, c, flash)
      put(x + 2, cy + 1, pad(clip(body2!, w - 4), w - 4), bodyC, flash)
      put(x + w - 1, cy + 1, vt, c, flash)
    }
    if (body3 !== undefined) {
      put(x, cy + 2, vt, c, flash)
      put(x + 2, cy + 2, pad(clip(body3, w - 4), w - 4), bodyC, flash)
      put(x + w - 1, cy + 2, vt, c, flash)
    }
    put(x, cy + 1 + extra, bl + hz.repeat(w - 2) + br, c, flash)
    for (let yy = cy - 1; yy <= cy + 1 + extra; yy++) for (let xx = x; xx < x + w; xx++) if (grid[yy]?.[xx]) grid[yy][xx].line = false
    return { x, w }
  }
  const cx = Math.floor(W / 2)
  // A small happy bounce of the centre box when a subagent finishes: up, down, up, down within FADE_MS,
  // only when there is room above it for the hop without touching the top row of agents.
  const justDone = effects.enabled ? list.reduce((t, n) => n.ended != null && now - n.ended >= 0 && now - n.ended < FADE_MS ? Math.max(t, n.ended) : t, -1) : -1
  const baseCy = Math.floor(H / 2) - (tallHead ? 1 : 0)
  const hop = justDone >= 0 && baseCy - 2 >= 4 ? [1, 0, 1, 0][Math.floor((now - justDone) / 150)] ?? 0 : 0
  const cy = baseCy - hop
  const top = list.slice(0, Math.ceil(list.length / 2))
  const bottom = list.slice(top.length)
  const row = (ns: Node[], y: number) => ns.map((n, i) => {
    const left = Math.floor(W * i / ns.length)
    const right = Math.floor(W * (i + 1) / ns.length)
    return { n, x: Math.floor((left + right) / 2), y, w: Math.min(64, right - left - 1) }
  })
  const spots = [...row(top, 1), ...row(bottom, H - 2)].filter(s => s.w >= 4)

  const doneCount = list.filter(isDone).length
  const all = list.length > 0 && doneCount === list.length
  const running = list.filter(n => !isDone(n) && n.status === 'running').length
  // what the main session itself is doing, shown while it acted in the last 8 s and no agent runs
  const mainBusy = !!main.last && now - main.at < 8000
  // Both robots step every three frames (~450 ms).
  const step = Math.floor(tick / 3)
  const p = step % 6
  const robot = effects.enabled && !narrow && step % 8 === 7 ? ROBOT_BLINK : ROBOT
  const failed = !running && list.some(n => n.status === 'failed')
  const arrival = fl.filter(f => LEAD.includes(f.to) && now - f.at >= FLIGHT_MS && now - f.at < FLIGHT_MS + 600)
    .reduce((latest, f) => Math.max(latest, f.at + FLIGHT_MS), -1)
  const blink = effects.enabled && (arrival >= 0 ? Math.floor((now - arrival) / 150) % 2 === 0 : step % 8 === 7)
  const eyes = (failed ? ['×', '×'] : justDone >= 0 ? ['^', '^'] : blink && (running || arrival >= 0) ? ['━', '━'] : all && !mainBusy ? ['^', '^'] : !running && !mainBusy ? ['−', '−'] : ['●', '●']).join(gap)
  const eyeColor = failed ? '#ff6b6b' : !running && !all ? '#8b949e' : '#5af78e'
  const eyeOffset = eyeHome + ((running || mainBusy) && effects.enabled && !blink ? [0, -1, 0, 1, 0, 0, 0, 0][step % 8] : 0)
  const failedCount = list.filter(n => n.status === 'failed' || n.status === 'killed').length
  const allDoneText = failedCount ? `Done · ${failedCount} failed` : 'All done'
  const info = running ? `${running} running` : mainBusy ? clip(pretty(clean(main.last)), 22) : all ? allDoneText : ''
  const leadBody2 = !c2 ? undefined
    : head ? tallHead ? `│${' '.repeat(eyeOffset)}${eyes}${' '.repeat(IW - eyeSpan - eyeOffset)}│${info ? ' ' + info : ''}` : `[${eyes}]${info ? ' ' + info : ''}`
    : all && list.length ? `${ROBOT_CHEER} ${allDoneText}`
    : !effects.enabled ? `${ROBOT}${running ? ` ${running} running` : ''}`
    : running ? narrow ? `${ROBOT} ${running} running` : `${'·'.repeat(p)}${robot}${'·'.repeat(5 - p)}  ${running} running`
    : ROBOT
  const leadBody = c2
    ? `${tallHead ? HEAD_TOP + ' ' : ''}${list.length ? `${progressBar(doneCount, list.length, tallHead ? 8 : 12)} ${doneCount}/${list.length}` : 'No agents yet'}${!running && !all && list.length ? ' ' + spin[tick % spin.length] : ''}`
    : all ? allDoneText : list.length ? 'Waiting ' + SPIN[tick % SPIN.length] : 'Idle'
  // boxes narrower than 4 columns are dropped above, so say how many agents are not drawn
  const hidden = list.length - spots.length
  const leadTitle = `◆ ${hasTeam ? 'Orchestrator' : 'Main'} ${doneCount}/${list.length}${hidden > 0 ? ` +${hidden} hidden` : ''}`
  const leadW = Math.min(W, Math.max(displayWidth(leadTitle) + 4, c2 ? displayWidth(leadBody) + 4 : 0, c2 ? displayWidth(leadBody2 ?? '') + 4 : 0, tallHead ? 0 : Math.floor(W * 0.36)))
  // with the head, the centre box hugs its content so the agent boxes keep the room
  const leadExtra = tallHead ? 2 : leadBody2 === undefined ? 0 : 1
  const leadL = cx - Math.floor(leadW / 2)
  const leadR = leadL + leadW - 1

  // Route of each agent: out of its box vertically to the orchestrator's row, then across to its side.
  const routes = new Map<string, { x: number; y: number }[]>()
  const straight = new Set<string>()
  for (const s of spots) {
    const pts: { x: number; y: number }[] = []
    const dir = s.y < cy ? 1 : -1
    if (s.x > leadL && s.x < leadR) {
      const edge = s.y < cy ? cy - 1 : cy + 1 + leadExtra
      for (let y = s.y + 2 * dir; dir * (edge - y) > 0; y += dir) pts.push({ x: s.x, y })
      straight.add(s.n.name)
    } else {
      for (let y = s.y + 2 * dir; dir * (cy + dir - y) > 0; y += dir) pts.push({ x: s.x, y })
      const end = s.x < cx ? leadL - 1 : leadR + 1
      const step = end > s.x ? 1 : -1
      for (let x = s.x + step; x !== end + step; x += step) pts.push({ x, y: cy })
    }
    routes.set(s.n.name, pts)
  }
  // Lay the lines: record each cell's neighbours, colour by the agent when it is working.
  const links = new Map<string, { dirs: Set<string>; c: string }>()
  for (const s of spots) {
    const pts = routes.get(s.n.name)!
    const c = c2 ? (isDone(s.n) ? C2.line : C2.run) : isDone(s.n) ? 'gray' : colorOf(list, s.n.name)
    pts.forEach((p, i) => {
      const k = `${p.x},${p.y}`
      const l = links.get(k) ?? { dirs: new Set<string>(), c }
      if (c !== 'gray') l.c = effects.enabled && !isDone(s.n) && s.n.status === 'running'
        ? hueShift(c, 25 * Math.sin(2 * Math.PI * (now / 4000 - i / 12))) : c
      for (const q of [pts[i - 1] ?? { x: s.x, y: s.y + (s.y < cy ? 1 : -1) }, pts[i + 1] ?? (straight.has(s.n.name) ? { x: p.x, y: p.y + (s.y < cy ? 1 : -1) } : { x: p.x + (p.x < cx ? 1 : -1), y: p.y })]) {
        if (q.y < p.y) l.dirs.add('u')
        if (q.y > p.y) l.dirs.add('d')
        if (q.x < p.x) l.dirs.add('l')
        if (q.x > p.x) l.dirs.add('r')
      }
      links.set(k, l)
    })
  }
  for (const [k, l] of links) {
    const [x, y] = k.split(',').map(Number)
    const key = ['u', 'd', 'l', 'r'].filter(d => l.dirs.has(d)).join('')
    put(x, y, GLYPH[key] ?? '·', l.c)
    if (grid[y]?.[x]) grid[y][x].line = true
  }

  // Messages in flight: just a dot with a trail running along the routes; the text lives in the bus.
  for (const f of fl) {
    const p = (now - f.at) / FLIGHT_MS
    if (p < 0 || p > 1) continue
    const c = c2 ? C2.art : colorOf(list, f.from)
    const targets = f.to === '*' ? spots.map(s => s.n.name).filter(n => n !== f.from) : [f.to]
    for (const to of targets) {
      const out = LEAD.includes(f.from) ? [] : routes.get(f.from.split('@')[0]) ?? []
      const back = LEAD.includes(to) ? [] : [...(routes.get(to.split('@')[0]) ?? [])].reverse()
      const pts = [...out, ...back]
      if (!pts.length) continue
      const i = Math.round(p * (pts.length - 1))
      for (const [d, ch] of [[4, '∙'], [2, '•'], [0, '●']] as const) {
        const q = pts[i - d]
        if (q) soft(q.x, q.y, ch, c, true)
      }
    }
  }

  // A box flashes for a moment after a message lands on it.
  const landed = (name: string) =>
    fl.some(f => (f.to === name || (f.to === '*' && f.from !== name)) && now - f.at >= FLIGHT_MS && now - f.at < FLIGHT_TTL)

  for (const { n, x, y, w } of spots) {
    const c = colorOf(list, n.name)
    const done = isDone(n)
    const fade = effects.enabled && done && n.ended != null ? easeInOutCubic((now - n.ended) / FADE_MS) : 1
    const toneFrom = (to: string, from = c) => fadeColor(from, to, fade)
    const took = n.since != null ? ` · ${secs((done ? n.ended ?? now : now) - n.since)}` : ''
    const failed = n.status === 'failed' || n.status === 'killed'
    const pending = isPending(n)
    const state = (failed ? '✗ ' + n.status : pending ? '○ ' + n.status : done ? (n.status === 'idle' ? '✓ idle' : '✓ done') : `● ${spin[tick % spin.length]} ${n.external ? secs(now - (n.since ?? now)) : n.tools}`) + (n.external && !done ? '' : took)
    const body = !n.last || n.last === 'starting' ? 'Starting' : pretty(clean(n.last))
    if (c2) {
      const tone = toneFrom(failed ? C2.fail : pending ? C2.pend : done ? C2.done : n.status === 'running' ? C2.run : C2.pend, C2.run)
      box(x, y, w, n.external ? `⬡ ${cap(n.name)}` : cap(n.name), state, body, tone, C2.log, landed(n.name), tone)
    } else
      box(x, y, w, n.external ? `⬡ ${cap(n.name)}` : cap(n.name), state, body, toneFrom(failed ? 'red' : done ? 'gray' : c), done ? toneFrom('gray', 'white') : undefined, landed(n.name), toneFrom(failed ? 'red' : done ? 'green' : c))
  }
  const lead = box(cx, cy, leadW, leadTitle, '', leadBody, c2 ? C2.hdr : 'cyan', c2 ? C2.log : all ? 'green' : 'cyan', LEAD.some(landed), undefined, leadBody2, tallHead ? HEAD_BOTTOM : undefined)
  if (head) {
    if (tallHead) {
      put(lead.x + 2, cy, HEAD_TOP, HEAD_FG, true)
      put(lead.x + 2, cy + 1, '│', HEAD_FG, true)
      put(lead.x + 3 + IW, cy + 1, '│', HEAD_FG, true)
      put(lead.x + 2, cy + 2, HEAD_BOTTOM, HEAD_FG, true)
    }
    const eyeX = lead.x + (tallHead ? 3 + eyeOffset : 3)
    // Keep tiny panes clipped to the body, away from the outer border and joins.
    put(eyeX, cy + 1, clip(eyes, Math.max(0, lead.x + lead.w - 2 - eyeX)), eyeColor, true)
  } else if (c2 && leadBody2) {
    const rob = all && list.length ? ROBOT_CHEER : robot
    const offset = effects.enabled && !narrow && running ? p : 0
    if (offset + displayWidth(rob) < leadW - 4)
      put(lead.x + 2 + offset, cy + 1, rob, HEAD_FG, true)
  }
  if (!list.length) {
    const hint = clip('No agents yet · They appear when work is delegated', W)
    put(Math.max(0, Math.round(cx - displayWidth(hint) / 2)), Math.min(H - 1, cy + 3 + (tallHead ? 1 : 0)), hint, 'gray')
  }
  // join the lines into the orchestrator's sides
  for (const s of spots) {
    if (straight.has(s.n.name)) {
      const jy = s.y < cy ? cy - 1 : cy + 1 + leadExtra
      // join only onto plain border, never over the title or status text
      if (grid[jy]?.[s.x]?.ch === '─') put(s.x, jy, s.y < cy ? '┴' : '┬', 'cyan')
    }
    else put(s.x < cx ? leadL : leadR, cy, s.x < cx ? '┤' : '├', 'cyan')
  }

  // tachyonfx SweepIn: eased sliding window, ten-cell gradient, zero directional variance.
  if (effects.enabled && effects.opened != null && now - effects.opened < SWEEP_MS) {
    const edge = easeInOutCubic((now - effects.opened) / SWEEP_MS) * (W + 10)
    for (const row of grid) for (let x = 0; x < W; x++) {
      const cell = row[x]
      const alpha = easeOutCirc((edge - x) / 10)
      if (alpha === 0) { cell.ch = ' '.repeat(displayWidth(cell.ch)); cell.c = undefined; cell.b = false }
      else if (alpha < 1) cell.c = fadeColor('#000000', cell.c ?? 'white', alpha)
    }
  }
  return grid.map(r => {
    const segs: Seg[] = []
    for (const cell of r) {
      const last = segs[segs.length - 1]
      if (last && last.c === cell.c && last.b === cell.b) last.t += cell.ch
      else segs.push({ t: cell.ch, c: cell.c, b: cell.b })
    }
    return segs
  })
}

// Retro theme, after the C2MS installer's bubbletea dashboard; colours lifted for dark terminals.
const ROBOT = '[•_•]'
const ROBOT_BLINK = '[-_-]'
const ROBOT_CHEER = '\\[^_^]/'

// mid-tones (not near-white) so outline, log text and Codex stay readable on light terminals too
const HEAD_FG = '#c8c2b5'
const C2 = {
  run: '#ffb454', done: '#7ee787', fail: '#ff6b6b', pend: '#8b949e', line: '#3d4450',
  hdr: '#a78bfa', art: '#79c0ff', log: '#a9b4c0', spin: '⣾⣽⣻⢿⡿⣟⣯⣷',
}
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
export const progressBar = (done: number, total: number, width: number) => {
  const full = total ? Math.round((done / total) * width) : 0
  return '█'.repeat(full) + '░'.repeat(width - full)
}
// Colour the progress bar as a purple→pink gradient; bold headers take the lavender accent.
export function retro(rows: Seg[][]): Seg[][] {
  return rows.map(segs => {
    const out: Seg[] = []
    for (const sg of segs) {
      const run = [...sg.t].filter(ch => ch === '█').length
      let i = 0
      for (const ch of sg.t) {
        const c = ch === '█' ? fadeColor('#a78bfa', '#f472b6', run > 1 ? Math.min(0.9999, i++ / (run - 1)) : 0)
          : ch === '░' ? C2.line
          : !sg.c && sg.b ? C2.hdr : sg.c
        const last = out[out.length - 1]
        if (last && last.c === c && last.b === sg.b && last.d === sg.d) last.t += ch
        else out.push({ t: ch, c, b: sg.b, d: sg.d })
      }
    }
    return out
  })
}

export const THEMES = ['classic', 'retro']
export function themeArg(args: string) {
  const m = /(?:^|\s)(?:--theme[=\s]+|-t\s+)?(\w+)\s*$/.exec(args.trim().toLowerCase())
  return m && THEMES.includes(m[1]) ? m[1] : undefined
}


export function drawBus(list: Node[], msgs: Msg[], W: number, now: number, count: number, timestamps: number[], lines = GRAPH_ROWS - 2): Seg[][] {
  // the elapsed timer only runs while some agent is working; idle, the header is just the count
  const busy = list.some(n => !isDone(n))
  // time of the current burst of work: since the earliest still-running agent started
  const runStart = Math.min(...list.filter(n => !isDone(n)).map(n => n.since ?? now), now)
  const elapsed = busy ? ` · ${secs(now - runStart)}` : ''
  const name = `${W < 70 ? 'Bus' : 'Message bus'} · ${count}${W >= 70 ? ' msgs' : ''}`
  const bars = spark(timestamps, now).slice(Math.max(0, 12 - W))
  const label = W >= 70 ? ' Activity ' : W > 12 ? ' ' : ''
  const titleW = Math.max(0, W - displayWidth(label + bars))
  const title = pad(clip(name + elapsed, titleW), titleW)
  const visible = msgs.slice(-Math.max(1, lines))
  return [
    // the bars are messages per 5 s over the last minute; a dim label names them when there is room
    // the elapsed time is dimmed so the bus name and count lead
    [{ t: title.slice(0, name.length), b: true }, { t: title.slice(name.length), d: true }, { t: label, c: 'gray' }, { t: bars, c: 'cyan' }],
    [{ t: '─'.repeat(W), c: 'gray' }],
    ...(msgs.length ? [] : [[{ t: clip('No messages yet', W), c: 'gray' }]]),
    ...visible.map((m, i) => {
      const age = i === visible.length - 1 ? 0 : i >= Math.floor((visible.length - 1) / 2) ? 1 : 2
      const d = age > 0
      const message = m.text.replace(/\s+/g, ' ')
      if (W < 7) return [{ t: clip(message, W), c: age === 2 ? '#808080' : undefined, d }]
      const head = W < 44 ? '' : `${new Date(m.at).toTimeString().slice(0, 8)} `
      // Give message text at least half the row; the route shares what remains.
      const nameW = Math.max(1, Math.floor((W - displayWidth(head) - Math.ceil(W / 2) - 4) / 2))
      const from = pad(clip(cap(m.from), nameW), nameW)
      const to = pad(clip(cap(m.to), nameW), nameW)
      const room = W - displayWidth(head + from + ' → ' + to + ' ')
      return [
        { t: head, c: 'gray', d }, { t: from, c: colorOf(list, m.from), b: true, d },
        { t: ' → ', c: 'gray', d }, { t: to, c: colorOf(list, m.to), d },
        { t: ' ' + clip(message, room), d },
      ].map(s => age === 2 ? { ...s, c: fadeColor(s.c ?? 'white', 'gray', 0.5) } : s)
    }),
  ]
}

// Teammates in tmux run as separate processes, so their tool calls never reach these hooks.
// Read what they leave on disk instead: team config (isActive, colour), inboxes, tmux panes.
let home = ''
let teamDir = ''
let wasBusy = false
const toldFailed = new Set<string>()
let paneOpen = false
let animating = false
let fastMotion = false
let lastLookup = -Infinity
let teamFailures = 0
let socket = ''
let refreshing = false
let uid = ''
let taskDir = ''
let loadedAt = 0
let externalPolling = false
const externalCounts: Record<string, number> = {}
const seen = new Set<string>()
let noMotion = false
let motionEnvRead = false
let viewportRows = 30
let tmpdir: string | undefined
let uidRead = false
let inboxPolling = false
let socketLookup = -Infinity
const rejectedPaths = new Map<string, string>()
const rejectedAt = new Map<string, { at: number; count: number }>()
const teamConfigs = new Map<string, { stamp: string; config: any }>()

export const motionEnabled = (preference: boolean, rows: number, reduced: boolean) => preference && rows >= 20 && !reduced

function resetTeam() {
  teamDir = ''
  lastLookup = -Infinity
  teamFailures = 0
  socket = ''
  socketLookup = -Infinity
  seen.clear()
}

// Teams this session leads. A resumed session gets a new id while its team keeps the old one,
// so also take the team named in this session's own agent ids (`codex-review@session-3c6e60b6`).
async function ownTeams($: EngineInterface, agents: Awaited<ReturnType<EngineInterface['agent']['list']>>) {
  const sid = await $.session.id()
  const names = new Set([`session-${sid.slice(0, 8)}`])
  for (const a of agents) {
    const m = /@(session-[0-9a-f]{8})$/.exec(a.id)
    if (m) names.add(m[1])
  }
  return { sid, names }
}

async function teamConfig($: EngineInterface, path: string, listingStamp = '') {
  const metadata = await $.fs.stat(`${path}/config.json`).catch(() => undefined)
  const stamp = metadata ? `${listingStamp}:${metadata.mtimeMs}:${metadata.size}` : ''
  const cached = teamConfigs.get(path)
  if (stamp && cached?.stamp === stamp) return cached.config
  const raw = await $.fs.read(`${path}/config.json`)
  const config = JSON.parse(raw)
  teamConfigs.set(path, { stamp, config })
  return config
}

async function findTeam($: EngineInterface, identity: Awaited<ReturnType<typeof ownTeams>>) {
  if (!home) home = await $.env.get('HOME') ?? ''
  const root = `${home}/.claude/teams`
  const { sid, names } = identity
  const dirs = (await $.fs.list(root).catch(() => [])).filter(d => d.kind === 'dir')
  const candidates = new Set([...names, ...dirs.map(d => d.name)])
  for (const path of teamConfigs.keys()) if (!candidates.has(path.split('/').at(-1)!)) teamConfigs.delete(path)
  for (const name of candidates) {
    const entry = dirs.find(d => d.name === name)
    const stamp = entry ? `${entry.mtimeMs}:${entry.size}` : ''
    let config
    try { config = await teamConfig($, `${root}/${name}`, stamp) } catch { continue }
    if (config.leadSessionId === sid || names.has(name)) return `${root}/${name}`
  }
  return ''
}

type Member = { name: string; agentType?: string; color?: string; tmuxPaneId?: string; isActive?: boolean; backendType?: string }

async function readTeam($: EngineInterface, identity: Awaited<ReturnType<typeof ownTeams>>): Promise<Member[]> {
  const now = await $.clock.now()
  if (!teamDir && now - lastLookup > 3000) {
    lastLookup = now
    const found = await findTeam($, identity)
    if (found !== teamDir) {
      resetTeam()
      lastLookup = now
    }
    teamDir = found
  }
  if (!teamDir) return []
  try {
    const config = await teamConfig($, teamDir)
    const { sid, names } = identity
    if (config.leadSessionId !== sid && !names.has(teamDir.split('/').at(-1)!)) {
      resetTeam()
      return []
    }
    if (!Array.isArray(config.members)) throw new Error('Invalid team members')
    teamFailures = 0
    return config.members.filter((m: Member) => m && typeof m === 'object' && typeof m.name === 'string')
  } catch {
    if (++teamFailures >= 3) resetTeam()
    return []
  }
}

export function rememberMessage(from: string, to: string, text: string, timestamp: unknown) {
  const key = JSON.stringify([from, to, text, timestamp])
  if (seen.has(key)) return false
  seen.add(key)
  if (seen.size > 500) seen.delete(seen.values().next().value!)
  return true
}

async function addMessage($: EngineInterface, from: string, to: string, text: string, timestamp?: unknown) {
  const now = await $.clock.now()
  from = clean(from)
  to = clean(to)
  text = clean(text)
  if (!rememberMessage(from, to, text, timestamp ?? now)) return
  await update($, log, l => [...l, { at: now, from, to, text }].slice(-50))
  await update($, messageCount, n => n + 1)
  await update($, times, ts => [...ts.filter(t => now - t < 60000), now])
  await update($, flights, l => [...l, { from, to, at: now }])
}

const PROTOCOL = ['idle_notification', 'shutdown_request', 'shutdown_approved', 'shutdown_response', 'teammate_terminated']
export function inboxMessages(raw: string, to: string) {
  const out: { from: string; to: string; text: string; timestamp: unknown }[] = []
  let items: unknown
  try { items = JSON.parse(raw.trim()) } catch { return out }
  if (!Array.isArray(items)) return out
  for (const m of items) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue
    if (typeof (m.summary ?? m.text) !== 'string' || (m.from != null && typeof m.from !== 'string')) continue
    let text = String(m.summary ?? m.text).trim()
    const rawText = String(m.text ?? '').trim()
    let target = to
    if (rawText.startsWith('{')) {
      try {
        const j = JSON.parse(rawText)
        if (j && typeof j === 'object') {
          if (PROTOCOL.includes(j.type)) continue
          const content = j.summary ?? j.content ?? j.text
          if (content != null) text = typeof content === 'string' ? content : JSON.stringify(content)
        }
      } catch {}
    }
    const peer = /^\[to ([^\]]+)\]\s*([\s\S]*)$/.exec(text)
    if (peer) { target = peer[1]; text = peer[2] }
    if (text) out.push({ from: String(m.from ?? '?'), to: target, text, timestamp: m.timestamp })
  }
  return out
}

async function pollInboxes($: EngineInterface) {
  const dir = teamDir
  if (!dir || inboxPolling) return
  inboxPolling = true
  try {
    for (const f of await $.fs.list(`${dir}/inboxes`).catch(() => [])) {
      if (!f.name.endsWith('.json')) continue
      let raw = ''
      try { raw = await $.fs.read(`${dir}/inboxes/${f.name}`) } catch { continue }
      if (dir !== teamDir) return
      for (const m of inboxMessages(raw, f.name.slice(0, -5)))
        await addMessage($, m.from, m.to, m.text, m.timestamp ?? '')
    }
  } finally { inboxPolling = false }
}

async function userId($: EngineInterface) {
  if (!uidRead) {
    uid = (await $.process.run(['id', '-u']).catch(() => ({ stdout: '' }))).stdout.trim()
    uidRead = true
  }
  return uid
}

// Resolve the owning socket once; pane ids are data, never shell text.
async function pollPanes($: EngineInterface, team: Member[]) {
  const panes = team.filter(m => /^%\d+$/.test(m.tmuxPaneId ?? ''))
  const out: Record<string, { last: string; tools: number }> = {}
  if (!panes.length || !paneOpen) return out
  if (!socket) {
    const now = await $.clock.now()
    if (now - socketLookup < 3000) return out
    socketLookup = now
    await userId($)
    if (!/^\d+$/.test(uid)) return out
    const root = `/private/tmp/tmux-${uid}`
    const entries = await $.fs.list(root).catch(() => [])
    entries.sort((a, b) => Number(a.name === 'default') - Number(b.name === 'default'))
    for (const entry of entries) {
      const candidate = `${root}/${entry.name}`
      for (const m of panes) {
        const result = await $.process.run(['tmux', '-S', candidate, 'display', '-p', '-t', m.tmuxPaneId!, '#{pane_id}']).catch(() => null)
        if (result?.stdout.trim() === m.tmuxPaneId) { socket = candidate; break }
      }
      if (socket) break
    }
  }
  if (!socket) return out
  for (const m of panes) {
    if (!paneOpen) break
    const result = await $.process.run(['tmux', '-S', socket, 'capture-pane', '-p', '-S', '-200', '-t', m.tmuxPaneId!]).catch(() => null)
    if (!result) continue
    const acts = result.stdout.split('\n')
      .map(l => l.trim()).filter(l => /^[⏺●]/.test(l))
      .map(l => l.replace(/^[⏺●]\s*/, ''))
      .filter(a => !/^[\w-]+: (reloaded|loaded)/.test(a))
    out[m.name] = { last: acts.at(-1) ?? '', tools: acts.filter(a => /^\w+\(/.test(a)).length }
  }
  return out
}

// $.ui.toast returns nothing; a throwing toast must not stop the bookkeeping after it.
function toast($: EngineInterface, text: string) {
  try { $.ui.toast(text) } catch {}
}

async function refreshNodes($: EngineInterface, capture = true, knownAgents?: Awaited<ReturnType<EngineInterface['agent']['list']>>) {
  if (refreshing) return
  refreshing = true
  try {
    const agents = knownAgents ?? await $.agent.list()
    const identity = await ownTeams($, agents)
    const team = await readTeam($, identity)
    const mates = team.filter(m => m.agentType !== 'team-lead')
    for (const m of mates) if (m.color) teamColors[m.name] = TEAM_COLOR[m.color] ?? m.color
    const panes = await pollPanes($, capture ? mates : [])
    const at = await $.clock.now()
    const old = await read($, nodes)
    const list: Node[] = mates.map(m => {
      const prev = old.find(o => o.name === m.name)
      const pane = panes[m.name]
      const active = m.isActive !== false
      const fresh = active && (!prev || isDone(prev))
      const base = fresh ? pane?.tools ?? 0 : prev?.base ?? 0
      const tools = fresh ? 0 : Math.max(prev?.tools ?? 0, pane ? pane.tools - base : 0)
      return {
        id: `${m.name}@team`, name: m.name, status: active ? 'running' : 'idle', base, tools,
        last: pane?.last || prev?.last || '', done: !active,
        since: fresh ? at : prev?.since,
        ended: active ? undefined : prev && !isDone(prev) ? at : prev?.ended,
      }
    })
    for (const a of agents) {
      if (mates.some(m => same({ id: `${m.name}@team`, name: m.name }, a.id))) continue
      const prev = old.find(o => o.id === a.id)
      const done = ['completed', 'failed', 'killed'].includes(a.status)
      const fresh = !done && (!prev || isDone(prev))
      list.push({
        id: a.id, name: a.name || a.description || a.type, status: a.status,
        tools: fresh ? 0 : prev?.tools ?? 0, last: prev?.last ?? '', done,
        since: fresh ? at : prev?.since,
        ended: done ? prev && !isDone(prev) ? at : prev?.ended ?? at : undefined,
      })
    }
    list.push(...old.filter(n => n.external))
    if (JSON.stringify(list) !== JSON.stringify(old)) await update($, nodes, cur => [...list.filter(n => !n.external), ...cur.filter(n => n.external)])
    for (const id of toldFailed) if (!list.some(n => n.id === id)) toldFailed.delete(id)
    for (const n of [...list, ...(await read($, nodes)).filter(x => x.external)])
      if ((n.status === 'failed' || n.status === 'killed') && !toldFailed.has(n.id)) {
        toldFailed.add(n.id)
        toast($, `✗ ${n.name} ${n.status}`)
      }
    const allDone = list.length > 0 && list.every(isDone)
    const failedCount = list.filter(n => n.status === 'failed' || n.status === 'killed').length
    if (allDone && wasBusy) toast($, failedCount
      ? `${list.length === 1 ? '1 agent' : `${list.length} agents`} finished · ${failedCount} failed`
      : list.length === 1 ? '1 agent done' : `All ${list.length} agents done`)
    wasBusy = list.length > 0 && !allDone
  } finally { refreshing = false }
}

async function startExternal($: EngineInterface, provider: string, task: string, output?: string) {
  const count = externalCounts[provider] = (externalCounts[provider] ?? 0) + 1
  const name = count === 1 ? provider : `${provider}-${count}`
  const at = await $.clock.now()
  const node: Node = { id: `${name}@external`, name, external: provider, status: 'running', tools: 0, last: '', done: false, since: at, changed: at, output, background: !!output }
  await update($, nodes, ns => [...ns, node])
  await addMessage($, 'main', name, `task: ${clip(task, 120)}`)
  return node
}

async function finishExternal($: EngineInterface, id: string, status: string, answer: string) {
  const at = await $.clock.now()
  const node = (await read($, nodes)).find(n => n.id === id)
  if (!node || node.done && node.status === status && (!answer || node.answer === answer)) return
  await update($, nodes, ns => ns.map(n => n.id === id ? { ...n, status, done: true, ended: n.ended ?? at, answer: answer || n.answer } : n))
  if (!node.done) await addMessage($, node.name, 'main', clip(answer || node.answer || status, 120))
}

// `/bin/zsh -lc 'rg -n x pages/'` becomes `rg -n x pages/`.
export const unshell = (cmd: string) => {
  const m = /^\S*\/(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*?)\1?(\.\.\.)?$/.exec(cmd.trim())
  return m ? m[2] + (m[3] ?? '') : cmd
}

const CODEX_SILENT_MS = 180000

async function pollExternal($: EngineInterface) {
  if (!paneOpen || externalPolling) return
  externalPolling = true
  try {
    await userId($)
    if (!/^\d+$/.test(uid)) return
    const sid = await $.session.id()
    if (taskDir && !taskDir.includes(`/${sid}/`)) taskDir = ''
    if (!taskDir) {
      tmpdir ??= await $.env.get('TMPDIR') ?? ''
      const tmp = tmpdir.trim().replace(/\/+$/, '')
      const roots = [...new Set([...(tmp.startsWith('/') ? [tmp] : []), '/private/tmp', '/tmp'])]
      const listed = new Set<string>()
      for (const base of roots) {
        // macOS /tmp is a symlink to /private/tmp: skip a root whose listing was already scanned
        const root = `${base}/claude-${uid}`
        const dirs = await $.fs.list(root).catch(() => [])
        const key = dirs.map(d => `${d.name}:${d.mtimeMs}`).join('|')
        if (key && listed.has(key)) continue
        listed.add(key)
        for (const dir of dirs) {
          if (dir.kind !== 'dir') continue
          if ((await $.fs.list(`${root}/${dir.name}`).catch(() => [])).some(d => d.name === sid)) {
            taskDir = `${root}/${dir.name}/${sid}/tasks`
            break
          }
        }
        if (taskDir) break
      }
    }
    const paths = new Map<string, { mtimeMs: number; size: number } | undefined>()
    for (const f of taskDir ? await $.fs.list(taskDir).catch(() => []) : [])
      if (f.name.endsWith('.output')) paths.set(`${taskDir}/${f.name}`, f)
    // Teammates' jobs live in sibling session folders.
    if (taskDir) {
      const project = taskDir.slice(0, taskDir.lastIndexOf(`/${sid}/`))
      for (const d of await $.fs.list(project).catch(() => [])) {
        if (d.kind !== 'dir' || d.name === sid) continue
        for (const f of await $.fs.list(`${project}/${d.name}/tasks`).catch(() => []))
          if (f.name.endsWith('.output') && f.mtimeMs >= loadedAt) paths.set(`${project}/${d.name}/tasks/${f.name}`, f)
      }
    }
    for (const n of await read($, nodes)) if (n.external && n.output && !n.done && !paths.has(n.output)) paths.set(n.output, undefined)
    for (const path of rejectedPaths.keys()) if (!paths.has(path)) rejectedPaths.delete(path)
    for (const path of rejectedAt.keys()) if (!paths.has(path)) rejectedAt.delete(path)
    const now = await $.clock.now()
    for (const [path, entry] of paths) {
      if (!paneOpen) break
      let node = (await read($, nodes)).find(n => n.external && n.output === path)
      const metadata = entry ?? await $.fs.stat(path).catch(() => undefined)
      const modified = metadata?.mtimeMs ?? NaN
      const signature = metadata ? `${metadata.mtimeMs}:${metadata.size}` : undefined
      if (node?.done && signature && rejectedPaths.get(path) === signature) continue
      if (!node && Number.isFinite(modified) && modified < loadedAt) continue
      if (!node && signature && rejectedPaths.get(path) === signature) continue
      // a log rejected 5+ times while growing (dev server, watcher) is re-read at most every 30 s
      const rejected = rejectedAt.get(path)
      if (!node && rejected && rejected.count >= 5 && now - rejected.at < 30000) continue
      const result = await $.process.run(['tail', '-c', '8192', path]).catch(() => null)
      if (!result || (typeof result.exitCode === 'number' && result.exitCode !== 0)) {
        // the log is gone (a stopped or cleaned-up job): a box still waiting on it is over
        const gone = (await read($, nodes)).find(n => n.external && n.output === path && !n.done)
        if (gone) await finishExternal($, gone.id, 'stopped', gone.answer ?? '')
        continue
      }
      const raw = result.stdout
      // Only actual Codex log lines count, not JSON transcripts quoting them.
      if (!node && !/^\[codex\] /m.test(raw)) {
        if (signature) rejectedPaths.set(path, signature)
        if (raw.trim()) rejectedAt.set(path, { at: now, count: (rejectedAt.get(path)?.count ?? 0) + 1 })
        continue
      }
      rejectedPaths.delete(path)
      if (!node && (await read($, nodes)).some(n => n.external && n.background !== false && !n.output && !n.done && now - (n.since ?? 0) < 10000)) continue
      // a Codex box that is still waiting without a log (a launch that runs in the foreground) adopts this log
      if (!node) {
        const waiting = (await read($, nodes)).find(n => n.external === 'codex' && !n.done && !n.output)
        if (waiting) {
          await update($, nodes, ns => ns.map(n => n.id === waiting.id ? { ...n, output: path } : n))
          node = { ...waiting, output: path }
        }
      }
      if (!node) node = await startExternal($, 'codex', unshell(/\[codex\] Running command: (.*)/.exec(raw)?.[1] ?? 'Codex job'), path)
      const changed = Number.isFinite(modified) ? modified : node.changed ?? now
      const lines = raw.split('\n')
      const activity = lines.filter(l => /^\[codex\] (Running command:|Assistant message captured:)/.test(l)).at(-1)
      const answer = lastCodexAnswer(raw) ?? node.answer ?? ''
      const last = activity
        ? activity.startsWith('[codex] Running command: ')
          ? `Running ▸ ${unshell(activity.slice('[codex] Running command: '.length))}`
          : activity.replace(CODEX_ANSWER, 'Says ▸ ')
        : node.last
      const exit = /^\[exited with code (-?\d+)\]/m.exec(raw)
      // Codex can think silently for minutes, so silence only ends a box after CODEX_SILENT_MS
      const finished = !!exit || /^\[codex\] Turn completed\./m.test(raw) || now - changed >= CODEX_SILENT_MS
      await update($, nodes, ns => ns.map(n => n.id === node!.id ? { ...n, last, answer, changed, ...(!finished ? { status: 'running', done: false, ended: undefined } : {}) } : n))
      if (finished) {
        // 128+ is a signal exit: the job was killed (TaskStop, timeout), not a Codex failure
        const code = exit ? Number(exit[1]) : 0
        await finishExternal($, node.id, code >= 128 ? 'stopped' : code !== 0 ? 'failed' : 'completed', answer)
        if (signature) rejectedPaths.set(path, signature)
      }
    }
    for (const n of await read($, nodes)) {
      if (n.external && n.background && !n.done && !n.output && now - (n.changed ?? now) >= 20000)
        await finishExternal($, n.id, 'completed', n.answer ?? '')
      // a job silent for 10 minutes was stopped without a final line; never leave it "running"
      else if (n.external && !n.done && now - (n.changed ?? n.since ?? now) >= 600000)
        await finishExternal($, n.id, 'stopped', n.answer ?? '')
    }
  } finally { externalPolling = false }
}

export function effectsActive(list: Node[], fl: Flight[], now: number, opened: number) {
  return opened >= 0 && now - opened < SWEEP_MS ||
    list.some(n => !isDone(n) || n.ended != null && now - n.ended >= 0 && now - n.ended < FADE_MS) ||
    fl.some(f => now - f.at < FLIGHT_TTL)
}

async function animate($: EngineInterface) {
  if (!paneOpen) return
  if (!motionEnabled(await read($, motion), viewportRows, noMotion)) { animating = false; fastMotion = false; return }
  const now = await $.clock.now()
  const fl = await read($, flights)
  const list = await read($, nodes)
  const opened = await read($, openedAt)
  const active = effectsActive(list, fl, now, opened)
  fastMotion = opened >= 0 && now - opened < SWEEP_MS || list.some(n => isDone(n) && n.ended != null && now - n.ended < FADE_MS)
  await pruneFlights($, now)
  // One final render reaches the exact endpoint even if no work remains.
  if (active || animating) await update($, frame, f => f + 1)
  animating = active
}

async function openGraph($: EngineInterface) {
  const at = await $.clock.now()
  animating = motionEnabled(await read($, motion), viewportRows, noMotion)
  fastMotion = animating
  await update($, openedAt, () => at)
  await $.ui.open({ id: PANE, title: 'Team graph' })
}

async function nameOf($: EngineInterface, id?: string) {
  if (!id) return 'team-lead'
  return (await read($, nodes)).find(n => same(n, id))?.name ?? id.split('@')[0]
}

// The AI CLI a shell command actually runs (the command word of a segment), not one it merely mentions.
const PROVIDERS = new Set(['codex', 'gemini', 'opencode', 'amp', 'kimi', 'copilot'])
export function providerOf(command: string): string | undefined {
  // the Codex helper counts only when asked to run work (task/review); status, result, cancel and setup
  // are checks on a job, however the command spells the helper (direct path or a "$S" variable)
  if (/codex-companion/.test(command))
    return /\bnode\s+(?:["']?[^\s"']*codex-companion\.mjs["']?|"?\$\{?\w+\}?"?)\s+(?:task|review|adversarial-review)(?![\w-])/.test(command) ? 'codex' : undefined
  // a `|` inside a quoted grep pattern is not a pipe, so blank quoted text before splitting
  for (const seg of command.replace(/"[^"]*"|'[^']*'/g, '""').split(/&&|\|\||;|\||\n/)) {
    // status/result/cancel only ask about a job; they are not one
    if (/codex-companion\.mjs/.test(seg)) { if (/codex-companion\.mjs\S*\s+(status|result|cancel)\b/.test(seg)) continue; return 'codex' }
    const words = seg.trim().split(/\s+/).filter(w => !/^\w+=/.test(w))
    const cmd = (words[0] ?? '').split('/').at(-1) ?? ''
    // `codex --version`, `gemini --help`, `codex login`: a check on the CLI, not a job
    if (PROVIDERS.has(cmd) && /^(-V|-v|--version|-h|--help|login|logout)$/.test(words[1] ?? '')) continue
    if (PROVIDERS.has(cmd)) return cmd
    if (cmd === 'claude' && /^(-p|--print)$/.test(words[1] ?? '')) return 'claude'
  }
  return undefined
}

// `Bash(npm run lint)`-style action for a subagent's tool call, shown as `Bash ▸ npm run lint`.
export function actionOf(tool: string, args: Record<string, unknown>) {
  const detail = args.command ?? args.description ?? args.file_path ?? args.pattern ?? args.path ?? args.url ?? args.query
  return typeof detail === 'string' && detail ? `${tool}(${detail.split('\n')[0]})` : tool
}

// The same folder can load twice (a --plugin-dir flag plus CLAUDE_CODE_PLUGIN_DIRS); both copies
// share this plugin's state, so only one copy, the owner, polls, records and draws.
const me = Math.random().toString(36).slice(2)
const ownsState = (current: { id: string; beat: number }, now: number) => !current.id || current.id === me || now - current.beat >= 3000
async function isOwner($: EngineInterface, renew = true) {
  const now = await $.clock.now()
  const current = await read($, owner)
  if (!ownsState(current, now)) return false
  if (!renew) return current.id === me // Rendering cannot write state; hooks and ticks claim ownership.
  let owns = false
  await update($, owner, current => {
    owns = ownsState(current, now)
    return owns ? { id: me, beat: now } : current
  })
  return owns
}

async function pruneFlights($: EngineInterface, now: number) {
  if ((await read($, flights)).some(f => now - f.at >= FLIGHT_TTL))
    await update($, flights, cur => cur.filter(f => now - f.at < FLIGHT_TTL))
}

async function trackSubagent($: EngineInterface, id: string, tool: string, args: Record<string, unknown>, at: number) {
  await refreshNodes($, false)
  if (!(await read($, nodes)).some(n => same(n, id))) {
    const a = (await $.agent.list().catch(() => [])).find(a => a.id === id)
    await update($, nodes, ns => ns.some(n => same(n, id)) ? ns : [...ns, { id, name: a?.name || a?.description || a?.type || id, status: 'running', tools: 0, last: '', done: false, since: at }])
  }
  // never reopen a box whose turn completed after this tool started (this update runs late, beside the tool)
  await update($, nodes, list => list.map(n => same(n, id) && !(n.ended != null && n.ended >= at) ? {
    ...n, status: 'running', tools: (isDone(n) ? 0 : n.tools) + 1,
    last: QUIET_TOOLS.includes(tool) ? n.last : actionOf(tool, args), done: false, since: isDone(n) ? at : n.since ?? at, ended: undefined,
  } : n))
}

export function resetModuleState() {
  home = teamDir = socket = uid = taskDir = ''
  wasBusy = paneOpen = animating = fastMotion = refreshing = externalPolling = inboxPolling = noMotion = motionEnvRead = uidRead = false
  lastLookup = socketLookup = -Infinity
  teamFailures = loadedAt = 0
  viewportRows = 30
  tmpdir = undefined
  toldFailed.clear(); seen.clear(); rejectedPaths.clear(); rejectedAt.clear(); teamConfigs.clear()
  for (const key of Object.keys(teamColors)) delete teamColors[key]
  for (const key of Object.keys(externalCounts)) delete externalCounts[key]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team-graph', description: 'Show or hide the agent graph; --theme classic|retro, --rows N, --motion off|on, --robot head|plain' })
    $.ui.status(undefined)
    if (!motionEnvRead) {
      motionEnvRead = true
      noMotion = (await $.env.get('NO_MOTION')) != null
    }
    const start = await $.clock.now()
    loadedAt = start
    paneOpen = await read($, shown)
    // keep the graph on screen across reloads when it was shown
    if ((await isOwner($)) && paneOpen) await openGraph($)
    $.clock.every(1000, async () => {
      if (!(await isOwner($))) return
      void pollInboxes($).catch(() => {})
      await refreshNodes($).catch(() => {})
      const now = await $.clock.now()
      if ((await read($, nodes)).some(n => n.external && n.done && now - (n.ended ?? now) > 300000))
        await update($, nodes, ns => ns.filter(n => !(n.external && n.done && now - (n.ended ?? now) > 300000)))
      await pollExternal($).catch(() => {})
      const current = await read($, nodes)
      for (const id of toldFailed) if (!current.some(n => n.id === id)) toldFailed.delete(id)
      await pruneFlights($, now)
      if ((await read($, times)).some(t => now - t >= 60000))
        await update($, times, ts => ts.filter(t => now - t < 60000))
      if (paneOpen && (await read($, nodes)).some(n => !isDone(n))) await update($, frame, f => f + 1)
    })
    // Idle callbacks return before any engine I/O; only finite transitions need fine frames.
    $.clock.every(40, async () => { if (paneOpen && fastMotion && (await isOwner($, false))) await animate($) })
    $.clock.every(150, async () => { if (paneOpen && animating && (await isOwner($, false))) await animate($) })
    return next(e)
  })

  // A pane: beside the chat in fullscreen terminals, inline under it otherwise. The toggle survives reloads.
  on('command.run', { command: 'team-graph' }, async ($, e) => {
    const commandArgs = String(e.args ?? '')
    const robotMatch = /(?:^|\s)--robot(?:[=\s]+(\S+))?/.exec(commandArgs)
    if (robotMatch) {
      if (!['head', 'plain'].includes(robotMatch[1])) return { text: 'Unknown robot. Pick one of: head, plain.' }
      if (await isOwner($)) {
        await update($, robotStyle, () => robotMatch[1])
        await update($, frame, f => f + 1)
      }
      return { text: `Robot ${robotMatch[1]}.` }
    }
    const motionMatch = /(?:^|\s)--motion(?:[=\s]+(\S+))?/.exec(commandArgs)
    if (motionMatch) {
      if (!['on', 'off'].includes(motionMatch[1])) return { text: 'Motion must be on or off.' }
      if (await isOwner($)) {
        await update($, motion, () => motionMatch[1] === 'on')
        animating = motionEnabled(motionMatch[1] === 'on', viewportRows, noMotion)
        fastMotion = false
        await update($, frame, f => f + 1)
      }
      return { text: `Motion ${motionMatch[1]}.` }
    }
    const rowsArg = /--rows[=\s]+(\d+)/.exec(commandArgs)
    if (rowsArg) {
      // 11 is the docked render's minimum height, so the reply matches what is drawn
      const rows = clamp(Number(rowsArg[1]), 11, 40)
      if (await isOwner($)) await update($, graphRows, () => rows)
      return { text: `Graph height set to ${rows} rows (docked view).` }
    }
    // `/team-graph --theme retro` (also `--theme=retro`, `-t retro`, or just `retro`); `classic` reverts
    const pick = themeArg(commandArgs)
    if (!pick && /--theme|-t\s/.test(commandArgs)) return { text: `Unknown theme. Pick one of: ${THEMES.join(', ')}.` }
    if (pick) {
      if (await isOwner($)) {
        await update($, theme, () => pick)
        if (!(await read($, shown))) {
          await update($, shown, () => true)
          await openGraph($)
        }
      }
      paneOpen = true
      return { text: pick === 'classic' ? 'Classic theme back.' : `${pick} theme on. /team-graph --theme classic to revert.` }
    }
    // one flip per /team-graph even when two loaded copies both receive it: only the owner flips
    if (await isOwner($)) {
      await update($, shown, v => !v)
      paneOpen = await read($, shown)
      if (paneOpen) await openGraph($)
      else await $.ui.close({ id: PANE })
    } else {
      await $.clock.sleep(50)
      paneOpen = await read($, shown)
    }
    // docking is the surface's call: fullscreen layout from 110 columns, else inline
    const where = e.presentation?.isFullscreen ? `fullscreen layout, ${e.presentation.columns} cols` : 'main-screen layout (opens inline)'
    return { text: paneOpen ? `Team graph shown (${where}). Run /team-graph again to hide it.` : 'Team graph hidden.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && (await isOwner($))) {
      paneOpen = false
      await update($, shown, () => false)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const args = (input.input ?? input.args ?? input) as Record<string, unknown>
    const command = String(args.command ?? input.command ?? '')
    const provider = e.tool === 'Bash' ? providerOf(command) : undefined
    const spawning = !e.agentId && e.tool === 'Agent'
    let at = 0
    let external: Node | undefined
    let before: Awaited<ReturnType<EngineInterface['agent']['list']>> = []
    try {
      if (!(await isOwner($))) return next(e)
      at = await $.clock.now()
      // the main session's own actions, for the Main box (agent spawns and messaging are shown elsewhere)
      if (!e.agentId && e.tool !== 'Agent' && !QUIET_TOOLS.includes(e.tool)) {
        await update($, mainLast, () => actionOf(e.tool, args))
        await update($, mainAt, () => at)
      }
      // Subagent bookkeeping runs beside the tool, not before it: the box shows the tool as it starts
      // without the tool waiting on the agent list and team files.
      if (e.agentId) void trackSubagent($, e.agentId, e.tool, args, at).catch(() => {})
      if (e.tool === 'SendMessage') {
        const raw = args.message ?? args.content ?? args.summary ?? ''
        const from = await nameOf($, e.agentId)
        const to = String(args.to ?? args.recipient ?? '?')
        for (const m of inboxMessages(JSON.stringify([{ from, summary: args.summary, text: typeof raw === 'string' ? raw : JSON.stringify(raw) }]), to))
          await addMessage($, m.from, m.to, m.text)
      }
      external = provider ? await startExternal($, provider, command.split('\n')[0]) : undefined
      before = spawning ? await $.agent.list().catch(() => []) : []
    } catch {} // Graph bookkeeping must never prevent the tool from running.
    let result
    try { result = await next(e) } catch (error) {
      // a thrown tool call is an interrupt or abort, not a failure of the AI CLI itself
      if (external) await finishExternal($, external.id, 'stopped', String(error)).catch(() => {})
      throw error
    }
    try {
      if (external) {
        const value = result as unknown as Record<string, unknown> | null
        const nested = value?.result as Record<string, unknown> | undefined
        const raw = typeof result === 'string' ? result : JSON.stringify(result) ?? ''
        const output = /\/[^\s"<>]*\.output\b/.exec(raw)?.[0]
        const stopped = !!value?.deny || !!nested?.interrupted
        const failed = !stopped && (value?.is_error || value?.isError || /\[exited with code (?!0\])-?\d+\]/.test(raw))
        // a foreground run that hit the Bash timeout or Ctrl+B keeps running in the background
        const movedToBackground = nested?.backgroundTaskId
        if (!failed && !stopped && ((args.run_in_background ?? input.run_in_background) || movedToBackground)) {
          await update($, nodes, ns => ns.filter(n => n.id === external.id || !n.external || n.output !== output).map(n => n.id === external.id ? { ...n, output, background: true } : n))
        } else {
          const outputText = typeof result === 'string' ? result : String(nested?.stdout ?? value?.stdout ?? value?.text ?? (Array.isArray(value?.content) ? value.content.map(c => c.text ?? '').join('\n') : ''))
          const answer = lastCodexAnswer(outputText)
          await finishExternal($, external.id, stopped ? 'stopped' : failed ? 'failed' : 'completed', answer ?? outputText.trim().split('\n').at(-1) ?? '')
        }
      }
      if (spawning) {
        const after = await $.agent.list().catch(() => [])
        const value = result as unknown as Record<string, unknown> | null
        const nested = value?.result as Record<string, unknown> | undefined
        const id = value?.agentId ?? value?.agent_id ?? nested?.agentId ?? nested?.agent_id
        const agent = after.find(a => a.id === id) ?? (typeof id === 'string' ? { id, name: '', description: String(args.description ?? ''), type: String(args.subagent_type ?? 'agent'), status: 'running' } : after.filter(a => !before.some(b => b.id === a.id)).at(-1) ?? after.at(-1))
        await refreshNodes($, false, after).catch(() => {})
        if (agent && !(await read($, nodes)).some(n => n.id === agent.id))
          await update($, nodes, ns => [...ns, { id: agent.id, name: agent.name || agent.description || agent.type, status: agent.status, tools: 0, last: '', done: false, since: at }])
        if (agent) await addMessage($, 'main', agent.name || agent.description || agent.type, `task: ${String(args.description ?? agent.description ?? '')}`)
      }
    } catch {} // Return the tool result even when graph bookkeeping fails.
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      if (!(await isOwner($))) return result
      const id = e.agentId
      if (id) {
        const at = await $.clock.now()
        const previous = (await read($, nodes)).find(n => same(n, id))
        await refreshNodes($, false).catch(() => {})
        const current = await read($, nodes)
        const agent = current.find(n => same(n, id)) ?? previous
        if (agent && !current.some(n => same(n, id))) await update($, nodes, ns => [...ns, agent])
        const failure = [previous?.status, agent?.status].find(status => status === 'failed' || status === 'killed')
        await update($, nodes, ns => ns.map(n => same(n, id) ? { ...n, status: failure ?? (['failed', 'killed'].includes(n.status) ? n.status : 'completed'), done: true, ended: n.ended ?? at } : n))
        if (agent && !agent.id.endsWith('@team'))
          await addMessage($, agent.name, 'main', clip(String(e.answer ?? '').split('\n')[0], 120))
      }
    } catch {} // Completion belongs to the host, even if polling fails.
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!(await isOwner($, false))) return next(e)
    paneOpen = true
    const { Box, Text, Button } = $.ui.resolve(e)
    const now0 = await $.clock.now()
    const list = (await read($, nodes)).filter(n => !(n.external && isDone(n) && now0 - (n.ended ?? now0) > 300000))
    const msgs = await read($, log)
    const fl = await read($, flights)
    await read($, frame) // Subscribe to animation invalidation.
    viewportRows = e.viewport?.rows ?? 30
    const enabled = motionEnabled(await read($, motion), viewportRows, noMotion)
    const now = await $.clock.now()
    const tick = enabled ? Math.floor(now / 150) : 0
    const effects = { enabled, opened: await read($, openedAt) }
    animating = enabled && effectsActive(list, fl, now, effects.opened)
    fastMotion = enabled && (effects.opened >= 0 && now - effects.opened < SWEEP_MS || list.some(n => isDone(n) && n.ended != null && now - n.ended < FADE_MS))
    const total = Math.max(0, (e.props.bodyColumns ?? e.viewport?.columns ?? 120) - 2)
    const hasTeam = list.some(n => n.id.endsWith('@team'))
    const saved = await read($, theme)
    const look = saved === 'c2ms' ? 'retro' : saved
    const style = await read($, robotStyle)
    const mainNow = { last: await read($, mainLast), at: await read($, mainAt) }
    const busArgs = [await read($, messageCount), await read($, times)] as const
    let rows: Seg[][]
    let divider = -1
    let H = GRAPH_ROWS
    if (total < 110) {
      // sidebar: graph on top, the bus below it with the remaining height
      // 0 = not set by the person yet: give the graph ~60% of the docked height
      const auto = Math.floor(((e.viewport?.rows ?? 30) - 8) * 0.6) | 1
      H = clamp((await read($, graphRows)) || auto, 11, 40)
      const busLines = Math.max(4, Math.min(60, (e.viewport?.rows ?? 30) - H - 8))
      divider = H
      rows = [
        ...drawGraph(list, total, enabled ? fl : [], now, tick, hasTeam, look, H, effects, style, mainNow),
        [{ t: '' }],
        ...drawBus(list, msgs, total, now, ...busArgs, busLines),
      ]
    } else {
      const busW = Math.min(64, Math.max(16, Math.floor(total * 0.34)))
      const W = total - busW - 3
      const graph = drawGraph(list, W, enabled ? fl : [], now, tick, hasTeam, look, GRAPH_ROWS, effects, style, mainNow)
      const bus = drawBus(list, msgs, busW, now, ...busArgs)
      rows = Array.from({ length: Math.max(graph.length, bus.length) }, (_, i) => {
        const g = graph[i] ?? []
        const width = g.reduce((n, sg) => n + displayWidth(sg.t), 0)
        return [...g, { t: ' '.repeat(Math.max(0, W - width)) }, { t: ' │ ', c: 'gray' }, ...(bus[i] ?? [])]
      })
    }

    if (look === 'retro') rows = retro(rows)

    return (
      <Box flexDirection="column">
        {rows.map((segs, i) => {
          const textOf = (ss: Seg[]) => <Text wrap="truncate">{ss.map(sg => (sg.c || sg.b || sg.d ? <Text color={sg.c} bold={!!sg.b} dimColor={!!sg.d}>{clean(sg.t)}</Text> : clean(sg.t)))}</Text>
          const line = textOf(segs)
          if (i !== divider) return line
          // keys sit next to their arrows; the left half (k ▲) shrinks, the right half (▼ j) grows
          const label = clip('k ▲ resize ▼ j', total)
          const split = label.includes('▼') ? label.indexOf('▼') : label.length
          const spare = Math.max(0, total - displayWidth(label))
          const left = '─'.repeat(Math.floor(spare / 2)) + label.slice(0, split)
          const right = label.slice(split) + '─'.repeat(Math.ceil(spare / 2))
          const smaller = () => update($, graphRows, () => Math.max(11, H - 2))
          const bigger = () => update($, graphRows, () => Math.min(40, H + 2))
          return (
            <Box flexDirection="row" width={total} overflow="hidden">
              <Button key="graph-smaller-line" label={left} plain dimColor onPress={smaller} />
              <Button key="graph-bigger-line" label={right} plain dimColor onPress={bigger} />
              {/* Native hotkey hints use the theme accent; clip those hints to keep the divider neutral. */}
              <Box width={0} height={0} overflow="hidden">
                <Button key="graph-smaller" label="" hotkey="k" plain dimColor onPress={smaller} />
                <Button key="graph-bigger" label="" hotkey="j" plain dimColor onPress={bigger} />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
