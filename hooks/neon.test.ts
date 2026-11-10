import { expect, test } from 'claude-code/testing'
import type { Node } from '../types'
import { harness } from './fake-engine'
import { drawNeon, neonFits, neonState } from './neon'
import type { NeonView } from './neon'
import { drawGraph } from './register'
import { displayWidth } from './text'
import type { Seg } from './text'
import { lookOf, THEMES, themeArg } from './themes'

const agents = (count: number): Node[] => Array.from({ length: count }, (_, i) => ({
  id: `agent-${i}@team`, name: `agent-${i}`, status: 'running', tools: 1, last: 'Read', done: false,
}))
const list = agents(4)
const text = (rows: Seg[][]) => rows.map(row => row.map(s => s.t).join('')).join('\n')
const view = (overrides: Partial<NeonView> = {}): NeonView => ({
  list, msgs: [], W: 100, now: 0, count: 0, extra: '',
  listRows: 24, busLines: 6, live: false, spin: '●', ...overrides,
})
const graph = (nodes: Node[], W: number, now = 0, tick = 0, enabled = false) =>
  drawGraph(nodes, W, [], now, tick, true, 'neon', 15, { enabled })
const cell = (rows: Seg[][], x: number, y: number) => {
  let end = 0
  return rows[y].find(s => { end += displayWidth(s.t); return end > x })
}

test('neon theme arguments preserve classic, retro and saved-theme compatibility', () => {
  expect(THEMES).toEqual(['classic', 'retro', 'neon'])
  for (const args of ['neon', '--theme neon', '--theme=neon', '-t neon']) expect(themeArg(args)).toBe('neon')
  for (const theme of THEMES) expect(lookOf(theme)).toBe(theme)
  expect(lookOf('c2ms')).toBe('retro')
})

test('neon selection persists into a fresh session', async () => {
  const writes: [string, unknown][] = []
  const first = harness({ store: { set: async (key: string, value: unknown) => { writes.push([key, value]) } } })
  await first.run('command.run', { command: 'team-graph', args: '--theme neon' })
  expect(writes).toContainEqual(['theme', 'neon'])
  const second = harness({ store: { get: async (key: string) => key === 'theme' ? 'neon' : undefined } })
  await second.run('session.start')
  expect(second.state('theme')).toBe('neon')
})

test('session start ignores an invalid stored theme', async () => {
  const h = harness({ store: { get: async () => 'vapor' } })
  const defaultTheme = h.state('theme')
  await h.run('session.start')
  expect(h.state('theme')).toBe(defaultTheme)
  expect(h.state('theme')).not.toBe('vapor')
})

test('neon cards require enough columns for the team', () => {
  expect(neonFits(100, 4)).toBe(true)
  expect(neonFits(40, 4)).toBe(false)
  expect(neonFits(120, 20)).toBe(false)
})

for (const W of [100, 60, 40, 24]) {
  for (const count of [1, 4, 8, 12, 20]) {
    test(`neon layout stays within ${W} columns with ${count} agents`, () => {
      const nodes = agents(count)
      const fits = neonFits(W, count)
      const rows = drawNeon(view({ list: nodes, W, graph: fits ? graph(nodes, W - 4) : undefined }))
      expect(text(rows)).toContain(fits ? 'NETWORK TOPOLOGY' : 'AGENTS')
      for (const row of rows) expect(row.reduce((sum, s) => sum + displayWidth(s.t), 0) <= W).toBe(true)
    })
  }
}

const states = [
  { node: list[0], label: 'RUNNING', color: '#FFCA73' },
  { node: { ...list[0], status: 'completed', done: true }, label: 'DONE', color: '#62EDAA' },
  { node: { ...list[0], waiting: true }, label: 'NEEDS YOU', color: '#ED75E5' },
  { node: { ...list[0], status: 'failed', done: true }, label: 'FAILED', color: '#FF6B6B' },
  { node: { ...list[0], status: 'pending', tools: 0, last: '' }, label: 'PENDING', color: '#758499' },
]
for (const { node, label, color } of states) {
  test(`neon card renders ${label} with its status colour`, () => {
    const row = graph([node], 96)[2]
    expect(text([row])).toContain(label)
    expect(row.some(s => s.t.includes(label) && s.c === color)).toBe(true)
    expect(neonState(node, 0, '●').label).toBe(label)
    expect(neonState(node, 0, '●').color).toBe(color)
  })
}

test('neon routes use cyan for running agents and muted blue for done agents', () => {
  for (const done of [false, true]) {
    const nodes = [{ ...list[0], done, status: done ? 'completed' : 'running' }]
    const route = cell(graph(nodes, 96), 48, 4)
    expect(route?.t).toContain('╎')
    expect(route?.c).toBe(done ? '#2A3A4F' : '#69E8FF')
    const animated = cell(graph(nodes, 96, 1000, 3, true), 48, 4)
    expect(animated?.t).toContain('╎')
    if (done) expect(animated?.c).toBe('#2A3A4F')
    else {
      expect(animated?.c).not.toBe('#69E8FF')
      expect(/^#[\da-f]{6}$/i.test(animated?.c ?? '')).toBe(true)
      const color = animated?.c ?? ''
      const red = parseInt(color.slice(1, 3), 16)
      expect(parseInt(color.slice(3, 5), 16) > red).toBe(true)
      expect(parseInt(color.slice(5, 7), 16) > red).toBe(true)
    }
  }
})

test('neon messages in flight draw amber dots on routes', () => {
  const rows = drawGraph(list, 96, [{ from: 'main', to: 'agent-0', at: 0 }], 900, 6, true, 'neon', 15, { enabled: true })
  const routes = graph(list, 96, 900, 6, true)
  let dots = 0
  rows.forEach((row, y) => {
    let x = 0
    for (const seg of row) for (const ch of seg.t) {
      if ('∙•●'.includes(ch) && seg.c === '#FFCA73') {
        expect(/^[╎╌├┤┬┴╭╮╰╯]+$/.test(cell(routes, x, y)?.t ?? '')).toBe(true)
        dots++
      }
      x += displayWidth(ch)
    }
  })
  expect(dots > 0).toBe(true)
})

test('neon graph text stays fixed across time and ticks with effects disabled', () => {
  expect(text(graph(list, 96, 0, 0))).toBe(text(graph(list, 96, 5000, 21)))
  expect(text(drawNeon(view({ now: 0, graph: graph(list, 96, 0, 0) }))))
    .toBe(text(drawNeon(view({ now: 5000, graph: graph(list, 96, 5000, 21) }))))
})

test('neon static agent list shows STATIC instead of LIVE', () => {
  const rows = drawNeon(view({ live: false }))
  expect(text(rows)).toContain('STATIC')
  expect(text(rows)).not.toContain('LIVE')
})

test('NO_MOTION makes the neon pane render STATIC through ui.render', async () => {
  const h = harness({ env: { get: async (n: string) => n === 'NO_MOTION' ? '1' : n === 'HOME' ? '/home/test' : undefined } })
  await h.run('session.start')
  await h.run('command.run', { command: 'team-graph', args: '--theme neon' })
  const rendered = JSON.stringify(await h.run('ui.render', {
    props: { bodyColumns: 40 }, viewport: { columns: 40, rows: 40 },
  }))
  expect(rendered).toContain('STATIC')
  expect(rendered).not.toContain('LIVE')
})

test('neon stream shows waiting agents as permission requests', () => {
  const rows = drawNeon(view({ list: [{ ...list[0], waiting: true }] }))
  expect(text(rows)).toContain('agent-0 requires permission')
})

test('neon stream marks only the done sender last message with a check', () => {
  const rows = drawNeon(view({
    list: [{ ...list[0], status: 'completed', done: true }], count: 2,
    msgs: [
      { from: 'agent-0', to: 'main', at: 0, text: 'working' },
      { from: 'agent-0', to: 'main', at: 1000, text: 'finished' },
    ],
  }))
  expect(text(rows).split('\n').find(row => row.includes('finished'))).toContain('✓ agent-0')
  expect(text(rows).split('\n').find(row => row.includes('working'))).toContain('› agent-0')
})

test('neon stream marks lead task messages as handoffs', () => {
  const rows = drawNeon(view({ count: 1, msgs: [{ from: 'team-lead', to: 'agent-0', at: 0, text: 'task: inspect UI' }] }))
  expect(text(rows).split('\n').find(row => row.includes('task: inspect UI'))).toContain('↗ Main')
})

test('neon stream title includes usage only when supplied', () => {
  const extra = ' · $0.86 · limit 24%'
  const title = text(drawNeon(view({ count: 3, extra }))).split('\n').find(row => row.includes('EVENT STREAM'))
  expect(title).toContain(`3 messages${extra}`)
  expect(text(drawNeon(view()))).not.toContain('$0.86')
  expect(text(drawNeon(view()))).not.toContain('limit 24%')
})

test('classic and retro graphs do not inherit neon cyan', () => {
  for (const done of [false, true]) {
    const nodes = [{ ...list[0], done, status: done ? 'completed' : 'running' }]
    const rows = drawGraph(nodes, 96, [], 0, 0, true, 'retro', 15, { enabled: false })
    // The single agent is centred at x=48; row 4 is below its box and above the orchestrator.
    const route = cell(rows, 48, 4)
    expect(route?.t).toContain('╎')
    expect(route?.c).toBe(done ? '#3d4450' : '#ffb454')
  }
  expect(drawGraph(list, 80, [], 0, 0, false, 'classic').flat().some(s => s.c === '#69E8FF')).toBe(false)
})

test('an unknown saved theme draws as classic, as it did before neon', () => {
  expect(lookOf('vapor')).toBe('classic')
  expect(lookOf('')).toBe('classic')
})

test('every neon row is exactly the pane width, for any width and team size', () => {
  for (const W of [100, 60, 40, 24]) for (const count of [0, 1, 4, 8, 12, 20]) {
    const nodes = agents(count)
    const msgs = nodes.map((n, i) => ({ at: i, from: n.name, to: 'main', text: 'a fairly long message that has to be clipped somewhere' }))
    const rows = drawNeon(view({ list: nodes, msgs, W, graph: neonFits(W, count) ? graph(nodes, W - 4) : undefined }))
    for (const row of rows) expect(displayWidth(row.map(s => s.t).join(''))).toBe(W)
  }
})

test('a static neon graph does not claim to be live', () => {
  const rows = drawNeon(view({ graph: graph(list, 96), live: false }))
  expect(text(rows)).toContain('NETWORK TOPOLOGY')
  expect(text(rows)).not.toContain('LIVE')
  expect(text(drawNeon(view({ graph: graph(list, 96), live: true })))).toContain('NETWORK TOPOLOGY / LIVE')
})

test('a finished team has no cyan link left, joins included', () => {
  const done = agents(4).map(n => ({ ...n, status: 'completed', done: true, since: 0, ended: 1 }))
  expect(graph(done, 96).flat().some(s => s.c === '#69E8FF')).toBe(false)
  expect(graph(list, 96).flat().some(s => s.c === '#69E8FF')).toBe(true)
})

test('a pending agent keeps a muted link until it starts', () => {
  const nodes: Node[] = [{ ...agents(1)[0], status: 'pending' }, ...agents(1).map(n => ({ ...n, id: 'b@team', name: 'b' }))]
  const colours = (rows: Seg[][]) => rows.flat().filter(s => /^[╎╌├┤┬┴╭╮╰╯]+$/.test(s.t)).map(s => s.c)
  expect(colours(graph([nodes[0]], 96))).not.toContain('#69E8FF')
  expect(colours(graph([nodes[1]], 96))).toContain('#69E8FF')
})

test('an agent that ends without a message still shows in the stream', () => {
  const killed: Node = { ...agents(1)[0], name: 'worker', status: 'killed', done: true, since: 0, ended: 5000 }
  const finished: Node = { ...agents(1)[0], id: 'q@team', name: 'quiet', status: 'completed', done: true, since: 0, ended: 6000 }
  const out = text(drawNeon(view({ list: [killed, finished], msgs: [] })))
  expect(out).toContain('✗ worker killed')
  expect(out).toContain('✓ quiet finished')
  // an agent that did send a message is not repeated as an event
  const spoke = text(drawNeon(view({ list: [finished], msgs: [{ at: 1, from: 'quiet', to: 'main', text: 'done here' }] })))
  expect(spoke).not.toContain('quiet finished')
})
