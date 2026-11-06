import { expect, test } from 'claude-code/testing'
import { drawBus, drawGraph, fadeColor, retro, tokensText, usageText, withFeatures } from './register'
import { harness, stateKey } from './fake-engine'

const node = { id: 'x', name: 'x', status: 'running', tools: 1, last: '', done: false, since: 0 }
const text = (rows: { t: string }[][]) => rows.map(r => r.map(s => s.t).join('')).join('\n')

test('bounce frames, expiry, disabled motion, short panes and future completions', () => {
  const agents = [{ ...node, status: 'completed', done: true, ended: 1000 }, { ...node, id: 'y', name: 'y' }]
  const headRow = (rows: { t: string }[][]) => rows.findIndex(r => r.map(s => s.t).join('').includes('╭───'))
  const at = (now: number, enabled = true, height = 20, list = agents) => drawGraph(list, 80, [], now, 0, false, 'retro', height, { enabled }, 'head')
  const rest = headRow(at(5000))
  for (const [now, offset] of [[1000, -1], [1150, 0], [1300, -1], [1450, 0]]) expect(headRow(at(now))).toBe(rest + offset)
  expect(text(at(5000))).not.toContain('^')
  for (const now of [1000, 1150, 1300, 1450]) {
    expect(headRow(at(now, false))).toBe(rest)
    expect(text(at(now, false))).not.toContain('^')
    expect(headRow(at(now, true, 9))).toBe(headRow(at(5000, true, 9)))
  }
  expect(headRow(at(1000, true, 20, agents.map(n => ({ ...n, ended: 2000 }))))).toBe(rest)
})

test('fresh foreign owner leaves all hook state unchanged; stale owner is claimed atomically', async () => {
  let now = 10000
  const h = harness({ clock: { now: async () => now } })
  await h.run('session.start')
  h.set('nodes', [node]); h.set('shown', true)
  for (const [name, event] of [
    ['tool.call', { tool: 'Read', agentId: 'x' }],
    ['turn.complete', { agentId: 'x', answer: 'done' }],
    ['ui.render', { props: {}, viewport: { columns: 80, rows: 30 } }],
    ['ui.close', { id: 'team-graph' }],
  ] as const) {
    h.set('owner', { id: 'other', beat: now })
    const before = JSON.stringify([...h.values])
    let calls = 0
    const result = await h.run(name, event, async () => { calls++; return 'host result' })
    expect(calls).toBe(1)
    expect(result).toBe('host result')
    expect(JSON.stringify([...h.values])).toBe(before)
  }
  for (const [name, event] of [
    ['tool.call', { tool: 'Read', agentId: 'x' }],
    ['turn.complete', { agentId: 'x', answer: 'done' }],
    ['ui.close', { id: 'team-graph' }],
  ] as const) {
    h.set('owner', { id: 'other', beat: now - 3001 })
    await h.run(name, event)
    expect(h.state('owner').id).not.toBe('other')
    expect(h.state('owner').beat).toBe(now)
  }
  // Rendering is read-only. The next tick claims ownership before drawing.
  h.set('owner', { id: 'other', beat: now - 3001 })
  expect(await h.run('ui.render', { props: {}, viewport: { columns: 80, rows: 30 } })).toEqual({})
  await h.tick()
  expect(await h.run('ui.render', { props: {}, viewport: { columns: 80, rows: 30 } })).not.toEqual({})
  expect(h.state('owner').id).not.toBe('other')
})

test('turn completion retains failures and killed agents and omits team bus messages', async () => {
  const h = harness()
  await h.run('session.start')
  for (const status of ['failed', 'killed']) {
    h.set('nodes', [{ ...node, status, done: true, ended: 999 }])
    await h.run('turn.complete', { agentId: 'x', answer: 'result' })
    expect(h.state('nodes')[0].status).toBe(status)
    expect(h.state('nodes')[0].ended).toBe(999)
  }
  h.set('nodes', [{ ...node, id: 'x@team' }])
  const count = h.state('messageCount')
  await h.run('turn.complete', { agentId: 'x', answer: 'team result' })
  expect(h.state('nodes')[0].done).toBe(true)
  expect(h.state('messageCount')).toBe(count)
})

test('agent.list rejection never blocks tool.call or turn.complete delegation', async () => {
  const h = harness({ agent: { list: async () => { throw new Error('Offline') } } })
  await h.run('session.start')
  for (const [name, event] of [
    ['tool.call', { tool: 'Read', agentId: 'x' }],
    ['tool.call', { tool: 'Agent', input: { description: 'check' } }],
    ['turn.complete', { agentId: 'unknown', answer: 'done' }],
  ] as const) {
    let calls = 0
    expect(await h.run(name, event, async () => { calls++; return { agentId: 'new', text: 'host result' } })).toEqual({ agentId: 'new', text: 'host result' })
    expect(calls).toBe(1)
  }
  let calls = 0
  await h.run('tool.call', { tool: 'Read', agentId: 'x' }, async () => { calls++; throw new Error('Host failure') }).then(() => { throw new Error('Expected rejection') }, e => expect(e.message).toBe('Host failure'))
  expect(calls).toBe(1)
})

test('subagent bookkeeping never delays the tool and lists agents once per refresh', async () => {
  let calls = 0, release = () => {}
  const h = harness({ agent: { list: () => { calls++; return new Promise<any[]>(r => { release = () => r([node]) }) } } })
  await h.run('session.start')
  let delegated = false
  await h.run('tool.call', { tool: 'Read', agentId: 'x' }, async () => { delegated = true; return 'result' })
  expect(delegated).toBe(true) // the tool ran while the agent list was still pending
  release()
  await new Promise(r => setTimeout(r, 0))
  expect(calls).toBe(1)
  expect(h.state('nodes')[0].tools).toBe(1)
})

test('teams reject another lead and accept a resumed team named by agent ids', async () => {
  let now = 10000, lead = 'test-session', stamp = 1, reads = 0
  let agents = [node]
  const root = '/home/test/.claude/teams', config = root + '/foreign/config.json'
  const h = harness({
    clock: { now: async () => now }, agent: { list: async () => agents },
    fs: {
      list: async (path: string) => path === root ? [{ name: 'foreign', kind: 'dir', mtimeMs: stamp, size: 1 }] : [],
      stat: async (path: string) => {
        if (path !== config && !path.endsWith('/session-abcdef12/config.json')) throw new Error('Missing')
        return { mtimeMs: stamp, size: 1 }
      },
      read: async (path: string) => {
        if (path !== config && !path.endsWith('/session-abcdef12/config.json')) throw new Error('Missing')
        reads++
        return JSON.stringify({ leadSessionId: lead, members: [{ name: 'peer', isActive: true }] })
      },
    },
  })
  await h.run('session.start'); await h.tick()
  expect(h.state('nodes').some((n: any) => n.id === 'peer@team')).toBe(true)
  const count = reads
  await h.tick(); await h.tick()
  expect(reads).toBe(count)
  lead = 'another-session'; stamp++; now += 1000
  await h.tick()
  expect(h.state('nodes').some((n: any) => n.id === 'peer@team')).toBe(false)
  agents = [{ ...node, id: 'x@session-abcdef12' }]; now += 4000
  await h.tick()
  expect(h.state('nodes').some((n: any) => n.id === 'peer@team')).toBe(true)
})

function logs() {
  let now = 100000, tails = 0
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const project = '/private/tmp/claude-501/project', dir = project + '/test-session/tasks'
  const h = harness({
    clock: { now: async () => now },
    fs: {
      list: async (path: string) => {
        if (path === '/private/tmp/claude-501') return [{ name: 'project', kind: 'dir' }]
        if (path === project) return [{ name: 'test-session', kind: 'dir' }, { name: 'sibling', kind: 'dir' }]
        return [...files].filter(([file]) => file.slice(0, file.lastIndexOf('/')) === path).map(([file, f]) => ({ name: file.split('/').at(-1), kind: 'file', mtimeMs: f.mtimeMs, size: f.text.length }))
      },
      stat: async (path: string) => { const f = files.get(path); if (!f) throw new Error('Gone'); return { ...f, size: f.text.length } },
    },
    process: { run: async (argv: string[]) => {
      if (argv[0] === 'id') return { stdout: '501' }
      expect(argv[0]).toBe('tail')
      tails++
      const f = files.get(argv.at(-1)!)
      if (!f) throw new Error('Gone')
      return { stdout: f.text }
    } },
  })
  return { ...h, files, dir, project, now: (value: number) => { now = value }, tails: () => tails }
}

test('Codex skips old and quoted logs, caches sibling rejections, and rechecks changed metadata', async () => {
  const h = logs()
  await h.run('session.start'); await h.run('command.run', { command: 'team-graph' })
  h.files.set(h.dir + '/old.output', { text: '[codex] Running command: old', mtimeMs: 99999 })
  const sibling = h.project + '/sibling/tasks/quoted.output'
  h.files.set(sibling, { text: '{"message":"[codex] Running command: quoted"}', mtimeMs: 100000 })
  await h.tick()
  expect(h.state('nodes') ?? []).toEqual([])
  expect(h.tails()).toBe(1)
  await h.tick(); expect(h.tails()).toBe(1)
  h.files.set(sibling, { text: '[codex] Running command: live', mtimeMs: 100001 })
  h.now(100001); await h.tick()
  expect(h.state('nodes')[0].last).toBe('Running ▸ live')
  expect(h.tails()).toBe(2)
})

test('a growing non-Codex log is tailed at most every 30 s after five rejections', async () => {
  const h = logs()
  await h.run('session.start'); await h.run('command.run', { command: 'team-graph' })
  let t = 100000
  for (let i = 0; i < 5; i++) { h.files.set(h.dir + '/server.output', { text: 'GET / 200 ' + i, mtimeMs: t }); h.now(t); await h.tick(); t += 1000 }
  const tails = h.tails()
  for (let i = 0; i < 5; i++) { h.files.set(h.dir + '/server.output', { text: 'GET / 200 x' + i, mtimeMs: t }); h.now(t); await h.tick(); t += 1000 }
  expect(h.tails()).toBe(tails)
  h.now(t + 30000); h.files.set(h.dir + '/server.output', { text: 'GET / 200 later', mtimeMs: t + 30000 }); await h.tick()
  expect(h.tails()).toBe(tails + 1)
})

test('Codex foreground adopts a log and a gone log stops its agent', async () => {
  const h = logs()
  await h.run('session.start'); await h.run('command.run', { command: 'team-graph' })
  await h.run('tool.call', { tool: 'Bash', command: 'codex exec fix' }, async () => {
    h.files.set(h.dir + '/live.output', { text: '[codex] Running command: check\n[codex] Assistant message captured: first\n{"message":"[codex] Assistant message captured: quoted"}\n[codex] Assistant message captured: last', mtimeMs: 100000 })
    await h.tick()
    expect(h.state('nodes').length).toBe(1)
    expect(h.state('nodes')[0].output).toBe(h.dir + '/live.output')
    expect(h.state('nodes')[0].answer).toBe('last')
    h.files.clear(); await h.tick()
    expect(h.state('nodes')[0].status).toBe('stopped')
    return { stdout: 'last' }
  })
})

test('Codex background finishes after 20 seconds; silent foreground stops after ten minutes', async () => {
  const h = logs()
  await h.run('session.start'); await h.run('command.run', { command: 'team-graph' })
  await h.run('tool.call', { tool: 'Bash', command: 'codex exec fix', run_in_background: true })
  h.now(119999); await h.tick(); expect(h.state('nodes')[0].done).toBe(false)
  h.now(120000); await h.tick(); expect(h.state('nodes')[0].status).toBe('completed')
  await h.run('tool.call', { tool: 'Bash', command: 'codex exec slow' }, async () => {
    h.now(719999); await h.tick(); expect(h.state('nodes').at(-1).done).toBe(false)
    h.now(720000); await h.tick(); expect(h.state('nodes').at(-1).status).toBe('stopped')
    return {}
  })
})

test('flights and activity times prune after 61 seconds and finished externals after five minutes', async () => {
  let now = 100000
  const h = harness({ clock: { now: async () => now } })
  await h.run('session.start')
  h.set('flights', [{ from: 'x', to: 'main', at: now }]); h.set('times', [now])
  h.set('nodes', [{ ...node, external: 'codex', status: 'completed', done: true, ended: now }])
  now += 61000; await h.tick()
  expect(h.state('flights')).toEqual([]); expect(h.state('times')).toEqual([])
  expect(h.state('nodes').length).toBe(1)
  now = 400000; await h.tick(); expect(h.state('nodes').length).toBe(1)
  now++; await h.tick(); expect(h.state('nodes')).toEqual([])
})

test('finished logs do not spawn tail or stat processes repeatedly or reappear after pruning', async () => {
  const h = logs()
  await h.run('session.start'); await h.run('command.run', { command: 'team-graph' })
  h.files.set(h.dir + '/done.output', { text: '[codex] Turn completed.', mtimeMs: 100000 })
  await h.tick(); expect(h.state('nodes')[0].done).toBe(true)
  const tails = h.tails()
  await h.tick(); await h.tick(); expect(h.tails()).toBe(tails)
  h.now(400001); await h.tick()
  expect(h.state('nodes')).toEqual([]); expect(h.tails()).toBe(tails)
})

test('failure toast occurs once per id, clears when removed, and all-done toast retains its text', async () => {
  let agents = [node, { ...node, id: 'y', name: 'y' }]
  const toasts: string[] = []
  const h = harness({ agent: { list: async () => agents }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  agents = agents.map(n => ({ ...n, status: 'completed', done: true }))
  await h.tick(); expect(toasts).toEqual(['All 2 agents done'])
  agents = [{ ...node, status: 'failed', done: true }]
  await h.tick(); await h.tick()
  expect(toasts.filter(t => t === '✗ x failed').length).toBe(1)
  agents = []; await h.tick()
  agents = [{ ...node, status: 'failed', done: true }]; await h.tick()
  expect(toasts.filter(t => t === '✗ x failed').length).toBe(2)
})

test('a new session opens the graph by default, and a toggle-off is remembered', async () => {
  let opened = 0
  const h = harness({ ui: { open: async () => { opened++ } } })
  h.values.delete(stateKey('shown'))
  await h.run('session.start')
  expect(opened).toBe(1)
  await h.run('command.run', { command: 'team-graph' })
  expect(h.state('shown')).toBe(false)
})

test('a run that ends with failures says so instead of all done', async () => {
  let agents = [node, { ...node, id: 'y', name: 'y' }]
  const toasts: string[] = []
  const h = harness({ agent: { list: async () => agents }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  agents = [{ ...node, status: 'completed', done: true }, { ...node, id: 'y', name: 'y', status: 'failed', done: true }]
  await h.tick()
  expect(toasts).toContain('2 agents finished · 1 failed')
  expect(toasts).not.toContain('All 2 agents done')
  for (const look of ['retro', 'classic'])
    expect(text(drawGraph(agents, 120, [], 0, 1, false, look, 11, { enabled: false }, 'plain'))).toContain('Done · 1 failed')
})

test('rows flag clamps to the drawn range 11..40 so the reply matches the render', async () => {
  const h = harness(); await h.run('session.start')
  for (const [input, expected] of [[3, 11], [99, 40]]) {
    expect((await h.run('command.run', { command: 'team-graph', args: `--rows ${input}` })).text).toBe(`Graph height set to ${expected} rows (docked view).`)
    expect(h.state('graphRows')).toBe(expected)
  }
})

test('retro gradient matches the removed mixer for every progress-bar cell', () => {
  for (let width = 1; width <= 140; width++) {
    const colours = retro([[{ t: '█'.repeat(width) }]]).flat().flatMap(s => [...s.t].map(() => s.c))
    for (let i = 0; i < width; i++) {
      const p = width > 1 ? Math.min(0.9999, i / (width - 1)) : 0
      const old = '#' + [167, 139, 250].map((v, j) => Math.round(v + ([244, 114, 182][j] - v) * p).toString(16).padStart(2, '0')).join('')
      expect(colours[i]).toBe(old)
      expect(fadeColor('#a78bfa', '#f472b6', p)).toBe(old)
    }
  }
})

test('environment and uid are read once and unsuccessful socket probes back off', async () => {
  let now = 10000, ids = 0, probes = 0
  const env: string[] = []
  const h = harness({
    clock: { now: async () => now },
    env: { get: async (name: string) => { env.push(name); return name === 'HOME' ? '/home/test' : undefined } },
    fs: {
      list: async (path: string) => path === '/private/tmp/tmux-501' ? [{ name: 'default' }] : [],
      read: async (path: string) => {
        if (!path.endsWith('/config.json')) throw new Error('Missing')
        return JSON.stringify({ leadSessionId: 'test-session', members: [{ name: 'peer', tmuxPaneId: '%3' }] })
      },
    },
    process: { run: async (argv: string[]) => {
      if (argv[0] === 'id') { ids++; return { stdout: '501' } }
      if (argv.includes('display')) { probes++; return { stdout: 'no match' } }
      throw new Error('Unexpected process')
    } },
  })
  await h.run('session.start'); await h.run('command.run', { command: 'team-graph' })
  await h.tick(); expect(probes).toBe(1)
  now += 1000; await h.tick(); expect(probes).toBe(1)
  now += 2000; await h.tick(); expect(probes).toBe(2)
  await h.run('session.start'); await h.tick()
  expect(ids).toBe(1)
  for (const name of ['HOME', 'TMPDIR', 'NO_MOTION']) expect(env.filter(n => n === name).length).toBe(1)
})

test('inbox polling does not overlap and resumes after a read rejection', async () => {
  let release: ((text: string) => void) | undefined, reads = 0
  let reject = false
  const h = harness({
    fs: {
      list: async (path: string) => path.endsWith('/inboxes') ? [{ name: 'main.json' }] : [],
      read: async (path: string) => {
        if (path.endsWith('/config.json')) return JSON.stringify({ leadSessionId: 'test-session', members: [] })
        reads++
        if (reject) throw new Error('Read failed')
        return new Promise<string>(resolve => { release = resolve })
      },
    },
  })
  await h.run('session.start'); await h.tick()
  await h.tick(); expect(reads).toBe(1)
  await h.tick(); expect(reads).toBe(1)
  release!(JSON.stringify([{ from: 'x', text: 'hello', timestamp: 1 }]))
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(h.state('log')[0].text).toBe('hello')
  reject = true; await h.tick()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  reject = false; await h.tick(); expect(reads).toBe(3)
  release!('[]')
  for (let i = 0; i < 20; i++) await Promise.resolve()
})

test('toast rejection does not reject the polling tick', async () => {
  const h = harness({ agent: { list: async () => [{ ...node, status: 'failed' }] }, ui: { toast: () => { throw new Error('Closed UI') } } })
  await h.run('session.start'); await h.tick(); await h.tick()
  expect(h.state('nodes')[0].status).toBe('failed')
})


test('turn completion picks up engine failures after next even when the cached agent was running', async () => {
  let delegated = false, calls = 0
  const h = harness({ agent: { list: async () => { expect(delegated).toBe(true); calls++; return [{ ...node, status: 'failed' }] } } })
  await h.run('session.start'); h.set('nodes', [node])
  await h.run('turn.complete', { agentId: 'x', answer: 'failed' }, async () => { delegated = true; return 'host result' })
  expect(h.state('nodes')[0].status).toBe('failed')
  expect(calls).toBe(1)
})

test('a late subagent update never reopens a box that already finished', async () => {
  let release = () => {}
  let pending = false
  // the engine reports the agent finished by the time the slow list resolves
  const h = harness({ agent: { list: () => pending ? new Promise<any[]>(r => { release = () => r([{ ...node, status: 'completed' }]) }) : Promise.resolve([node]) } })
  await h.run('session.start')
  pending = true
  await h.run('tool.call', { tool: 'Read', agentId: 'x' }, async () => 'result')
  pending = false
  await h.run('turn.complete', { agentId: 'x', answer: 'done' })
  release()
  await new Promise(r => setTimeout(r, 0))
  expect(h.state('nodes').find((n: any) => n.id === 'x').done).toBe(true)
})

test('the all-done toast shows once, with the real engine toast that returns nothing', async () => {
  const toasts: string[] = []
  let agents: any[] = [node]
  const h = harness({ agent: { list: async () => agents }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  agents = [{ ...node, status: 'completed' }]
  await h.run('turn.complete', { agentId: 'x', answer: 'done' })
  await h.tick(); await h.tick(); await h.tick()
  expect(toasts.filter(t => t === '1 agent done').length).toBe(1)
})

test('UI polish: empty retro state, hidden-agent count, dim elapsed time and solid bus rule', () => {
  const draw = (list: typeof node[], width = 120) => text(drawGraph(list, width, [], 0, 0, false, 'retro', 11, { enabled: false }, 'head'))
  expect(draw([])).toContain('No agents yet')
  expect(draw([])).not.toContain('░')
  const many = Array.from({ length: 30 }, (_, i) => ({ ...node, id: `a${i}`, name: `a${i}` }))
  expect(draw(many, 60)).toMatch(/\+\d+ hidden/)
  expect(draw(many.slice(0, 2), 60)).not.toContain('hidden')
  const bus = drawBus([node], [], 80, 5000, 2, [], 4)
  expect(bus[0].find(s => s.t.includes('· 5s'))?.d).toBe(true)
  expect(bus[0].find(s => s.t.includes('Message bus · 2 msgs'))?.b).toBe(true)
  expect(bus[1][0].t).toBe('─'.repeat(80))
})

const ALL = { needs: true, tokens: true, reasons: true, limits: true }

test('needs-you follows the real order: tool.check asks inside tool.call, the box waits, and the answer clears it', async () => {
  const agents = [{ id: 'x', name: 'x', description: 'x', type: 'agent', status: 'running' }]
  const toasts: string[] = []
  const h = harness({ agent: { list: async () => agents }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  const ask = async () => ({ decision: 'ask' })
  let during: any
  // the engine runs tool.check (and the dialog) inside tool.call's next()
  await h.run('tool.call', { tool: 'Bash', agentId: 'x', tool_use_id: 'c1', input: { command: 'rm -rf build' } }, async () => {
    expect(await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'x', tool_use_id: 'c1' }, ask)).toEqual({ decision: 'ask' })
    await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'x', tool_use_id: 'c1' }, ask)
    await new Promise(r => setTimeout(r, 0))
    during = h.state('waits')
    const view = h.state('nodes').map((n: any) => withFeatures(n, ALL, h.state('waits')))
    const rows = text(drawGraph(view, 120, [], 0, 0, false, 'retro', 11, { enabled: false }, 'head'))
    expect(rows).toContain('⚑ needs you')
    expect(rows).toContain('⚑ 1 needs you')
    return { result: { stdout: '' }, text: '' }
  })
  expect(during).toEqual([{ agent: 'x', call: 'c1' }])
  expect(toasts).toEqual(['⚑ x needs you'])
  await new Promise(r => setTimeout(r, 0))
  expect(h.state('waits')).toEqual([])
  // a denied or interrupted call clears it too
  await h.run('tool.call', { tool: 'Bash', agentId: 'x', tool_use_id: 'c2', input: { command: 'x' } }, async () => {
    await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'x', tool_use_id: 'c2' }, ask)
    throw new Error('interrupted')
  }).catch(() => {})
  expect(h.state('waits')).toEqual([])
  expect((await h.run('command.run', { command: 'team-graph', args: '--needs off' })).text).toBe('Needs off.')
  await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'x' }, ask)
  expect(h.state('waits')).toEqual([])
  expect((await h.run('command.run', { command: 'team-graph', args: '--needs maybe' })).text).toBe('Use --needs on or --needs off.')
})

test('a first ask before the subagent box exists creates the box waiting and keeps it through discovery', async () => {
  const agents: any[] = []
  const toasts: string[] = []
  const h = harness({ agent: { list: async () => agents }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  agents.push({ id: 'new', name: 'fixer', description: 'fixer', type: 'agent', status: 'running' })
  await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'new', tool_use_id: 'c1' }, async () => ({ decision: 'ask' }))
  expect(h.state('nodes').map((n: any) => n.name)).toEqual(['fixer'])
  expect(h.state('waits')).toEqual([{ agent: 'new', call: 'c1' }])
  expect(toasts).toContain('⚑ fixer needs you')
  await h.tick()
  expect(h.state('waits')).toEqual([{ agent: 'new', call: 'c1' }])
  expect(withFeatures(h.state('nodes')[0], ALL, h.state('waits')).waiting).toBe(true)
  expect(withFeatures(h.state('nodes')[0], { ...ALL, needs: false }, h.state('waits')).waiting).toBeUndefined()
})

test('tokens and failure reasons come from turn.complete and survive a refresh', async () => {
  let agents = [{ id: 'x', name: 'x', description: 'x', type: 'agent', status: 'running' }]
  const h = harness({ agent: { list: async () => agents } })
  await h.run('session.start'); await h.tick()
  agents = [{ ...agents[0], status: 'failed' }]
  await h.run('turn.complete', { agentId: 'x', answer: 'Checking deployment\n\nError: deployment timed out\n', usage: { model: 'm', input_tokens: 9000, output_tokens: 3400, cache_read_input_tokens: 50000, cache_creation_input_tokens: 0 } }, async () => ({ text: '' }))
  await h.tick()
  const n = h.state('nodes')[0]
  expect(n.tokens).toBe(12400)
  expect(n.answer).toBe('Error: deployment timed out')
  const shown = text(drawGraph([withFeatures(n, ALL)], 120, [], 0, 0, false, 'classic'))
  expect(shown).toContain('12k tok')
  expect(shown).toContain('Error: deployment timed out')
  const hidden = text(drawGraph([withFeatures(n, { ...ALL, tokens: false, reasons: false })], 120, [], 0, 0, false, 'classic'))
  expect(hidden).not.toContain('tok')
  expect(hidden).not.toContain('deployment timed out')
  expect(tokensText(950)).toBe('950 tok')
  expect(tokensText(1234)).toBe('1.2k tok')
})

test('session cost and rate-limit use reach the bus title, each behind its flag', async () => {
  const h = harness()
  await h.run('session.start')
  await h.run('session.measure', { context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 41.6 }, { kind: 'seven_day', percentUsed: 12 }], cost: { usd: 1.234 }, changed: ['cost'] }, async () => ({}))
  const u = h.state('usage')
  expect(u).toEqual({ usd: 1.234, limit: 42, kind: 'five_hour' })
  const list = [{ ...node, tokens: 48000, done: true, status: 'completed' }]
  expect(usageText(list, u, ALL)).toBe(' · 48k tok · $1.23 · limit 42%')
  expect(usageText(list, u, { ...ALL, tokens: false })).toBe(' · limit 42%')
  expect(usageText(list, u, { ...ALL, limits: false })).toBe(' · 48k tok · $1.23')
  expect(usageText([], { usd: -1, limit: -1, kind: '' }, ALL)).toBe('')
  const title = drawBus(list, [], 120, 5000, 2, [], 4, usageText(list, u, ALL))[0].map(s => s.t).join('')
  expect(title).toContain('Message bus · 2 msgs · 48k tok · $1.23 · limit 42%')
  expect((await h.run('command.run', { command: 'team-graph', args: '--limits off' })).text).toBe('Limits off.')
  expect(h.state('features')).toEqual({ ...ALL, limits: false })
})

test('a parallel call finishing does not clear another open dialog; the box survives empty discovery', async () => {
  const toasts: string[] = []
  const h = harness({ agent: { list: async () => [] }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  const ask = async () => ({ decision: 'ask' })
  await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'ghost', tool_use_id: 'bash-1' }, ask)
  await h.run('tool.check', { tool: 'Edit', input: {}, agentId: 'ghost', tool_use_id: 'edit-1' }, ask)
  expect(toasts).toEqual(['⚑ ghost needs you'])
  await h.tick(); await h.tick()
  expect(h.state('nodes').map((n: any) => n.id)).toEqual(['ghost'])
  await h.run('tool.call', { tool: 'Read', agentId: 'ghost', tool_use_id: 'read-1', input: { file_path: 'a' } })
  expect(h.state('waits').map((w: any) => w.call)).toEqual(['bash-1', 'edit-1'])
  await h.run('tool.call', { tool: 'Bash', agentId: 'ghost', tool_use_id: 'bash-1', input: { command: 'ls' } })
  expect(h.state('waits').map((w: any) => w.call)).toEqual(['edit-1'])
  await h.run('turn.complete', { agentId: 'ghost', answer: 'done' }, async () => ({ text: '' }))
  expect(h.state('waits')).toEqual([])
})

test('an ask in auto mode shows no needs-you; the same ask in default mode does', async () => {
  const agents = [{ id: 'a', name: 'a', description: 'a', type: 'agent', status: 'running' }, { id: 'd', name: 'd', description: 'd', type: 'agent', status: 'running' }]
  const toasts: string[] = []
  const h = harness({ agent: { list: async () => agents }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  await h.run('agent.spawn', { tool_use_id: 's1', prompt: '', description: 'a', subagentType: 'x', permissionMode: 'auto' }, async () => ({ model: 'm', agentId: 'a' }))
  await h.run('agent.spawn', { tool_use_id: 's2', prompt: '', description: 'd', subagentType: 'x', permissionMode: 'default' }, async () => ({ model: 'm', agentId: 'd' }))
  expect(h.state('modes')).toEqual({ a: 'auto', d: 'default' })
  const ask = async () => ({ decision: 'ask' })
  await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'a', tool_use_id: 'c1' }, ask)
  await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'd', tool_use_id: 'c2' }, ask)
  expect(h.state('waits')).toEqual([{ agent: 'd', call: 'c2' }])
  expect(toasts).toEqual(['⚑ d needs you'])
})

test('Codex boxes get unique names after a reload, and boxes sharing a name each keep their own line', async () => {
  const h = harness()
  await h.run('session.start')
  h.set('nodes', [{ ...node, id: 'codex@external', name: 'codex', external: 'codex' }])
  await h.run('tool.call', { tool: 'Bash', command: 'codex exec one', run_in_background: true }, async () => ({ text: 'Output file: /tmp/x/one.output' }))
  await h.run('tool.call', { tool: 'Bash', command: 'codex exec two', run_in_background: true }, async () => ({ text: 'Output file: /tmp/x/two.output' }))
  expect(h.state('nodes').map((n: any) => n.name)).toEqual(['codex', 'codex-2', 'codex-3'])
  const twins = [0, 1, 2].map(i => ({ ...node, id: `t${i}`, name: 'twin' }))
  const rows = text(drawGraph(twins, 79, [], 0, 0, false, 'classic', 21))
  const lines = rows.split('\n')
  // the two top boxes route sideways to the centre box: both elbows are drawn
  expect(lines.some(l => (l.match(/╰/g) ?? []).length >= 2 || l.includes('╰') && l.includes('╯'))).toBe(true)
})

test('in auto mode a plugin ask or a question tool still needs the person; parallel launches get distinct names', async () => {
  const agents = [{ id: 'a', name: 'a', description: 'a', type: 'agent', status: 'running' }]
  const toasts: string[] = []
  const h = harness({ agent: { list: async () => agents }, ui: { toast: (text: string) => { toasts.push(text) } } })
  await h.run('session.start'); await h.tick()
  await h.run('agent.spawn', { tool_use_id: 's1', prompt: '', description: 'a', subagentType: 'x', permissionMode: 'auto' }, async () => ({ model: 'm', agentId: 'a' }))
  await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'a', tool_use_id: 'c1' }, async () => ({ decision: 'ask' }))
  expect(h.state('waits') ?? []).toEqual([])
  await h.run('tool.check', { tool: 'Bash', input: {}, agentId: 'a', tool_use_id: 'c2' }, async () => ({ decision: 'ask', plugin: 'guard' }))
  await h.run('tool.check', { tool: 'AskUserQuestion', input: {}, agentId: 'a', tool_use_id: 'c3' }, async () => ({ decision: 'ask' }))
  expect(h.state('waits').map((w: any) => w.call)).toEqual(['c2', 'c3'])
  expect(toasts).toEqual(['⚑ a needs you'])
  const launch = (n: number) => h.run('tool.call', { tool: 'Bash', command: `codex exec job${n}`, run_in_background: true }, async () => ({ text: `Output file: /tmp/x/job${n}.output` }))
  await Promise.all([launch(1), launch(2)])
  const names = h.state('nodes').filter((n: any) => n.external).map((n: any) => n.name)
  expect(new Set(names).size).toBe(names.length)
})
