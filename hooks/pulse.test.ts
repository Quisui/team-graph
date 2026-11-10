import { expect, test } from 'claude-code/testing'
import type { Node } from '../types'
import { harness } from './fake-engine'
import { drawNeon, neonFits } from './neon'
import type { NeonView } from './neon'
import { along, arrive, glow, gradient, shimmer, SPINNERS, spinnerFrame } from './pulse'
import { drawGraph } from './register'
import { displayWidth } from './text'
import type { Seg } from './text'
import { layoutOf, NEON, paletteOf, THEMES, themeArg } from './themes'

const agents = (count: number): Node[] => Array.from({ length: count }, (_, i) => ({
  id: `agent-${i}@team`, name: `agent-${i}`, status: 'running', tools: 1, last: 'Read', done: false,
}))
const list = agents(4)
const text = (rows: Seg[][]) => rows.map(row => row.map(s => s.t).join('')).join('\n')
const view = (overrides: Partial<NeonView> = {}): NeonView => ({
  list, msgs: [], W: 100, now: 0, count: 0, extra: '', listRows: 24, busLines: 6,
  live: true, spin: '●', theme: 'pulse', fx: true, tick: 0, ...overrides,
})
const brand = (rows: Seg[][]) => rows[0].filter(s => s.b)
const graph = (now: number, tick: number, enabled = true, theme = 'pulse') =>
  drawGraph(list, 96, [], now, tick, true, theme, 15, { enabled })

test('pulse selects the stacked effects layout and the neon palette', () => {
  expect(THEMES).toContain('pulse')
  expect(themeArg('--theme pulse')).toBe('pulse')
  expect(layoutOf('pulse').stacked).toBe(true)
  expect(layoutOf('pulse').fx).toBe(true)
  expect(layoutOf('neon').stacked).toBe(true)
  expect(layoutOf('neon').fx).toBe(false)
  expect(paletteOf('pulse')).toBe(NEON)
})

test('pulse spinners select literal frames and wrap', () => {
  expect(spinnerFrame('arc', 0)).toBe('◜')
  expect(spinnerFrame('arc', 6)).toBe('◜')
  expect(spinnerFrame('dots', 1)).toBe('⠙')
})

test('every spinner frame occupies one display cell', () => {
  for (const frames of Object.values(SPINNERS)) {
    for (const frame of frames) expect(displayWidth(frame)).toBe(1)
  }
})

test('gradient preserves characters and starts at the first stop', () => {
  const segs = gradient('A😀B', ['#000000', '#ffffff'])
  expect(segs).toHaveLength(3)
  expect(segs.map(s => s.t)).toEqual(['A', '😀', 'B'])
  expect(text([segs])).toBe('A😀B')
  expect(segs[0].c).toBe('#000000')
})

test('gradient phase changes colours without changing text', () => {
  const still = gradient('AB', ['#000000', '#ffffff'])
  const shifted = gradient('AB', ['#000000', '#ffffff'], 0.5)
  expect(shifted.map(s => s.c)).toEqual(['#808080', '#000000'])
  expect(shifted.map(s => s.c)).not.toEqual(still.map(s => s.c))
  expect(text([shifted])).toBe('AB')
})

test('along reaches black and white endpoints', () => {
  expect(along(['#000000', '#ffffff'], 0)).toBe('#000000')
  expect(['#ffffff', '#fefefe']).toContain(along(['#000000', '#ffffff'], 1))
})

test('glow stays between the base colour and white throughout its period', () => {
  for (const now of [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600]) {
    const colour = glow('#204060', now)
    expect(/^#[\da-f]{6}$/i.test(colour)).toBe(true)
    const channels = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16))
    expect(channels[0] >= 32 && channels[0] <= 255).toBe(true)
    expect(channels[1] >= 64 && channels[1] <= 255).toBe(true)
    expect(channels[2] >= 96 && channels[2] <= 255).toBe(true)
  }
  expect(glow('#204060', 400)).not.toBe('#204060')
})

test('glow returns the base colour at the sine minimum', () => {
  expect(glow('#204060', 1200, 1600)).toBe('#204060')
  expect(glow('#204060', 600, 800)).toBe('#204060')
})

test('shimmer preserves text and brightens only segments inside the band', () => {
  const segs: Seg[] = [...'ABCDEF'].map(t => ({ t, c: '#000000', b: true }))
  const lit = shimmer(segs, 900, 1800, 1)
  expect(text([lit])).toBe('ABCDEF')
  expect(lit.map(s => s.c)).toEqual(['#000000', '#000000', '#000000', '#999999', '#000000', '#000000'])
  expect(lit.every(s => s.b)).toBe(true)
  expect(segs.map(s => s.c)).toEqual(['#000000', '#000000', '#000000', '#000000', '#000000', '#000000'])
  expect(shimmer(segs, 0, 1800, 1)).toEqual(segs)
})

test('arrive starts white and settles at the requested duration', () => {
  expect(arrive('#204060', 0)).toBe('#ffffff')
  expect(arrive('#204060', 1200)).toBe('#204060')
  expect(arrive('#204060', 2400)).toBe('#204060')
  expect(arrive('#204060', 0, 400)).toBe('#ffffff')
  expect(arrive('#204060', 400, 400)).toBe('#204060')
  expect(arrive('#204060', 401, 400)).toBe('#204060')
})

test('pulse header names the theme and animates brand colours', () => {
  const first = drawNeon(view())
  const later = drawNeon(view({ now: 750, tick: 1 }))
  expect(text([first[0]])).toContain('TEAM GRAPH / PULSE')
  expect(text([later[0]])).toContain('TEAM GRAPH / PULSE')
  expect(brand(first).map(s => s.c)).not.toEqual(brand(later).map(s => s.c))
})

test('pulse motion off preserves all pane text and colours across time', () => {
  const first = drawNeon(view({ fx: false, tick: 0 }))
  const later = drawNeon(view({ fx: false, now: 5000, tick: 21 }))
  expect(text(first)).toBe(text(later))
  expect(later).toEqual(first)
})

for (const W of [100, 60, 40]) for (const count of [1, 4, 8]) {
  test(`pulse rows are exactly ${W} cells wide with ${count} agents`, () => {
    const nodes = agents(count)
    const rows = drawNeon(view({
      list: nodes, W, now: 750, tick: 1,
      graph: neonFits(W, count) ? drawGraph(nodes, W - 4, [], 750, 1, true, 'pulse', 15, { enabled: true }) : undefined,
    }))
    expect(text(rows)).toContain(neonFits(W, count) ? 'NETWORK TOPOLOGY' : 'AGENTS')
    for (const row of rows) expect(displayWidth(text([row]))).toBe(W)
  })
}

test('pulse running card titles use dots spinner frames', () => {
  const first = graph(0, 0)
  // dots advance one frame every 80 ms, as in cli-spinners
  const later = graph(80, 1)
  for (const n of list) {
    expect(text(first)).toContain(`⠋ ${n.name}`)
    expect(text(later)).toContain(`⠙ ${n.name}`)
  }
})

test('pulse running card borders change colour with time', () => {
  const border = (rows: Seg[][]) => {
    const row = rows.find(r => text([r]).includes('agent-0'))
    expect(row).toBeDefined()
    const corner = row?.find(s => s.t.includes('╭'))
    expect(corner).toBeDefined()
    return corner?.c
  }
  expect(border(graph(0, 1))).not.toBe(border(graph(400, 1)))
})

test('pulse motion off matches the static neon graph in text and colours', () => {
  const first = graph(0, 0, false)
  const later = graph(5000, 21, false)
  expect(text(first)).toContain('● agent-0')
  expect(later).toEqual(first)
  expect(first).toEqual(graph(0, 0, false, 'neon'))
  expect(later).toEqual(graph(5000, 21, false, 'neon'))
})

test('neon keeps its name and two solid brand colours without effects', () => {
  const rows = drawNeon(view({ theme: 'neon', fx: false }))
  expect(text([rows[0]])).toContain('TEAM GRAPH / NEON')
  expect(brand(rows).map(s => s.c)).toEqual(['#69E8FF', '#ED75E5'])
  expect(brand(rows).map(s => s.t)).toEqual(['◆ TEAM GRAPH', ' / NEON'])
})

test('--pulse picks full or light, keeps it for new sessions, and refuses anything else', async () => {
  const writes: [string, unknown][] = []
  const h = harness({ store: { set: async (key: string, value: unknown) => { writes.push([key, value]) } } })
  await h.run('session.start')
  expect((await h.run('command.run', { command: 'team-graph', args: '--pulse light' })).text).toContain('light')
  expect(h.state('pulseMode')).toBe('light')
  expect(writes).toContainEqual(['pulseMode', 'light'])
  expect((await h.run('command.run', { command: 'team-graph', args: '--pulse fast' })).text).toBe('Use --pulse full or --pulse light.')
  const next = harness({ store: { get: async (key: string) => key === 'pulseMode' ? 'light' : undefined } })
  await next.run('session.start')
  expect(next.state('pulseMode')).toBe('light')
})

test('idle pulse keeps moving: full on the fast timer, light on the slow tick; other themes stop', async () => {
  const frames = async (look: string, mode?: string) => {
    let now = 10000
    const h = harness({ clock: { now: async () => now } })
    await h.run('session.start')
    await h.run('command.run', { command: 'team-graph', args: `--theme ${look}` })
    if (mode) await h.run('command.run', { command: 'team-graph', args: `--pulse ${mode}` })
    // no agents at all, and past the opening sweep: nothing is busy
    now += 1000
    await h.run('ui.render', { props: { bodyColumns: 100 }, viewport: { columns: 100, rows: 40 } })
    const before = h.state('frame') ?? 0
    await h.timers.get(16)!()
    const fast = (h.state('frame') ?? 0) - before
    await h.timers.get(150)!()
    return { fast, slow: (h.state('frame') ?? 0) - before - fast }
  }
  expect(await frames('pulse')).toEqual({ fast: 1, slow: 0 })
  expect(await frames('pulse', 'light')).toEqual({ fast: 0, slow: 1 })
  expect(await frames('neon')).toEqual({ fast: 0, slow: 0 })
})
