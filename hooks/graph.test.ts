import { expect, test } from 'claude-code/testing'
import { fakeEngine } from './fake-engine'
import { easeInOutCubic, easeOutCirc } from './easing'

import { clip, displayWidth, drawBus, drawGraph, GRAPH_ROWS, inboxMessages, pretty, register, rememberMessage, spark } from './register'
import { providerOf, logPathOf, rawCodexProgress, actionOf, unshell, shortPaths, retro, themeArg, progressBar, cap, fadeColor, hueShift, effectsActive, clean, motionEnabled } from './register'

const list = [
  { id: 'frontend@s', name: 'frontend', status: 'running', tools: 3, last: 'Bash', done: false },
  { id: 'backend@s', name: 'backend', status: 'running', tools: 5, last: 'Read', done: true },
  { id: 'reviewer@s', name: 'reviewer', status: 'running', tools: 0, last: '', done: false },
  { id: 'broker-api@s', name: 'broker-api', status: 'completed', tools: 2, last: 'Bash', done: false },
]
const text = (rows: { t: string }[][]) => rows.map(r => r.map(s => s.t).join('')).join('\n')

test('fits every agent and the orchestrator in a compact graph', () => {
  const rows = drawGraph(list, 120)
  const out = text(rows)
  expect(rows.length).toBe(GRAPH_ROWS)
  for (const name of ['Frontend', 'Backend', 'Reviewer', 'Broker-api', '◆ Orchestrator']) expect(out).toContain(name)
  expect(out).toContain('◆ Orchestrator 2/4')
  expect(out).toContain('Waiting')
  expect(out).toContain('⠋ 3')
  expect(out).toContain('✓ done')
})

test('a message in flight draws a coloured dot in the sender colour', () => {
  const rows = drawGraph(list, 120, [{ from: 'frontend', to: 'backend', at: 0 }], 900)
  expect(text(rows)).toContain('●')
  expect(rows.flat().some(s => s.t.includes('●') && s.c === 'blue')).toBe(true)
  expect(drawGraph(list, 120, [{ from: 'frontend', to: 'backend', at: 0 }], 5000)).toEqual(drawGraph(list, 120, [], 5000))
})

test('the dot travels without text and the receiver flashes on arrival', () => {
  const f = [{ from: 'frontend', to: 'backend', at: 0, text: 'diff ready' }]
  expect(text(drawGraph(list, 120, f, 900))).not.toContain('diff ready')
  expect(text(drawGraph(list, 120, f, 900))).toContain('●')
  expect(text(drawGraph(list, 120, f, 2000))).toContain('┏')
  expect(text(drawGraph(list, 120, f, 4000))).not.toContain('┏')
})

test('sparkline buckets recent messages and timers show per agent', () => {
  expect(spark([], 60000)).toBe('▁'.repeat(12))
  expect(spark([59000, 59500, 58000], 60000).at(-1)).toBe('█')
  const rows = drawGraph([{ ...list[0], since: 0 }], 120, [], 12000, 0)
  const out = text(rows)
  expect(out).toContain('12s')
  expect(out).not.toContain('frontend done')
})

test('agents join the orchestrator with clean right-angled lines and readable activity', () => {
  const out = text(drawGraph([{ ...list[0], last: 'Bash(npm run lint)' }, ...list.slice(1)], 140))
  for (const g of ['╌', '╎', '┤', '├']) expect(out).toContain(g)
  const three = text(drawGraph(list.slice(0, 3), 140))
  for (const g of ['╰', '╯', '╭']) expect(three).toContain(g)
  expect(pretty('Bash(npm run lint)')).toBe('Bash ▸ npm run lint')
  expect(out).toContain('Bash ▸')
})

const six = ['frontend', 'backend', 'reviewer', 'broker-api', 'designer', 'tester'].map((name, i) => ({ ...list[0], id: name, name, tools: i + 1, since: 0 }))

test('six agent names truncate only when status needs narrow column space', () => {
  for (const width of [47, 74, 80, 120]) {
    const rows = drawGraph(six, width, [], 12000)
    for (const name of six.map(n => cap(n.name))) expect(text(rows)).toContain(width < 70 ? name.slice(0, 3) : name)
    for (const row of rows) expect(displayWidth(row.map(s => s.t).join(''))).toBe(width)
  }
})

test('box status stays compact and failed subagents show a cross', () => {
  const out = text(drawGraph([...six, { ...list[0], name: 'failed-agent', status: 'failed', done: true }], 140))
  for (const noise of ['tools', '100%', '*']) expect(out).not.toContain(noise)
  expect(out).toContain('✗')
})

test('clips wide code points by display columns', () => {
  expect(displayWidth('界🙂a')).toBe(5)
  expect(clip('界🙂ab', 4)).toBe('界…')
  expect(clip('界🙂ab', 5)).toBe('界🙂…')
  expect(clip('界', 0)).toBe('')
})

test('dedup retains identical text at different timestamps and bounds history', () => {
  expect(rememberMessage('sender', 'receiver', 'same', 'stamp-1')).toBe(true)
  expect(rememberMessage('sender', 'receiver', 'same', 'stamp-1')).toBe(false)
  expect(rememberMessage('sender', 'receiver', 'same', 'stamp-2')).toBe(true)
  for (let i = 0; i < 501; i++) rememberMessage('sender', 'receiver', 'same', `later-${i}`)
  expect(rememberMessage('sender', 'receiver', 'same', 'stamp-1')).toBe(true)
})

test('inboxes skip malformed entries and protocol noise while keeping content', () => {
  expect(inboxMessages('{}', 'main').length).toBe(0)
  const raw = JSON.stringify([null, 3, [], ...['idle_notification', 'shutdown_request', 'shutdown_approved', 'shutdown_response', 'teammate_terminated'].map(type => ({ from: 'peer', text: JSON.stringify({ type, summary: 'noise' }) })), { from: 'peer', timestamp: 'one', text: '  {"type":"custom","content":"keep me"}  ' }, { from: 'peer', timestamp: 'two', text: JSON.stringify({ summary: '[to backend] first\nsecond' }) }])
  const messages = inboxMessages(raw, 'main')
  expect(messages.length).toBe(2)
  expect(messages[0].text).toBe('keep me')
  expect(messages[1].to).toBe('backend')
  expect(messages[1].text).toBe('first\nsecond')
})

test('bus rows fit their budget and narrow routes leave room for message text', () => {
  const msgs = [{ at: 50000, from: 'very-long-sender-name', to: 'very-long-recipient-name', text: 'important message content' }]
  for (const width of [25, 43, 44, 64]) {
    const rows = drawBus(six, msgs, width, 60000, 125, [59000])
    for (const row of rows) expect(displayWidth(row.map(s => s.t).join('')) <= width).toBe(true)
    expect(rows[2].at(-1)!.t).toContain('important')
    expect(text(rows)).toContain('125')
    expect(text(rows)).toContain('█')
    if (width < 44) expect(rows[2][0].t).toBe('')
  }
})

test('bus columns align short and wide names without wasting the text budget', () => {
  const msgs = [
    { at: 50000, from: 'a', to: '界', text: 'First message' },
    { at: 59000, from: 'very-long-sender-name', to: 'backend', text: 'Latest message' },
  ]
  for (const width of [25, 43, 44, 64]) {
    const rows = drawBus(six, msgs, width, 60000, 2, []).slice(2)
    const positions = rows.map(row => displayWidth(row.slice(0, -1).map(s => s.t).join('')))
    expect(positions[0]).toBe(positions[1])
    for (const row of rows) expect(displayWidth(row.map(s => s.t).join('')) <= width).toBe(true)
  }
})

test('older bus rows stay dim through retro colouring while the newest stays bright', () => {
  const msgs = [50000, 59000].map(at => ({ at, from: 'frontend', to: 'main', text: 'Message' }))
  const rows = drawBus(six, msgs, 64, 60000, 2, [])
  for (const themed of [rows, retro(rows)]) {
    expect(themed[2].every(s => s.d === true)).toBe(true)
    expect(themed[3].some(s => s.d === true)).toBe(false)
    expect(themed[3].some(s => s.c === 'blue')).toBe(true)
  }
})

test('long box titles leave a readable status and one-cell body padding', () => {
  const agents = [{ ...list[0], name: 'An exceptionally long agent name', last: 'Read(a very long file name)' }]
  for (const look of ['classic', 'retro']) {
    const rows = drawGraph(agents, 32, [], 0, 0, false, look)
    const top = text([rows[0]]).trim()
    const body = text([rows[1]]).trim()
    expect(top).toContain('…')
    expect(top).toContain('──● ' + (look === 'retro' ? '⣾' : '⠋') + ' 3')
    expect(body).toMatch(/^│ .*… │$/)
    for (const row of rows) expect(displayWidth(row.map(s => s.t).join(''))).toBe(32)
  }
})

test('tiny layouts and empty states stay inside their display columns', () => {
  const msgs = [{ at: 0, from: '界界', to: 'main', text: 'A long message' }]
  for (const width of [0, 1, 2, 3, 6, 7, 12, 16, 25]) {
    for (const look of ['classic', 'retro']) {
      for (const agents of [[], six]) {
        for (const row of drawGraph(agents, width, [], 0, 0, false, look))
          expect(displayWidth(row.map(s => s.t).join(''))).toBe(width)
      }
    }
    for (const messages of [[], msgs]) {
      for (const row of drawBus([], messages, width, 0, 0, []))
        expect(displayWidth(row.map(s => s.t).join('')) <= width).toBe(true)
    }
  }
})

test('short retro graphs keep routes finite and the robot inside its box', () => {
  for (const width of [7, 12, 25, 80]) {
    const rows = drawGraph(list.slice(0, 2), width, [], 0, 15, false, 'retro', 7)
    expect(rows.length).toBe(7)
    for (const row of rows) expect(displayWidth(row.map(s => s.t).join(''))).toBe(width)
    if (width <= 12) expect(text([rows[4]])).toMatch(/│$/)
  }
})

test('plain subagents use main as orchestrator and idle agents remain dim', () => {
  expect(text(drawGraph(six, 80, [], 0, 0, false))).toContain('◆ Main 0/6')
  const rows = drawGraph([{ ...list[0], status: 'idle', done: true }], 80)
  expect(rows.flat().some(s => s.c === 'gray' && s.t.includes('Frontend'))).toBe(true)
  expect(rows.flat().some(s => s.c === 'green' && s.t.includes('✓ idle'))).toBe(true)
})

test('hooks handle subagents, safe pane capture, and closed inbox polling', async () => {
  const handlers = new Map<string, Function>()
  const values = new Map<string, unknown>()
  const timers = new Map<number, Function>()
  let agents: { id: string; name: string; type: string; status: string; description: string }[] = []
  let now = 10000
  let opened = 0
  let debugWrites = 0
  let team = false
  let configFailures = 0
  let inboxStamp = 'first'
  let captureText = '⏺ Read(file)\n⏺ Bash(test)\n⏺ checking output'
  let releaseCapture: ((value: { stdout: string }) => void) | undefined
  let slowCapture = false
  const calls: string[][] = []
  const members = [{ name: 'peer', tmuxPaneId: '%3', isActive: true }, { name: 'unsafe', tmuxPaneId: "%4'; injected", isActive: false }]
  const engine = fakeEngine({
    clock: { now: async () => now, },
    agent: { list: async () => agents },
    fs: {
      write: async () => { debugWrites++ },
      list: async (path: string) => path.endsWith('/inboxes') ? [{ name: 'main.json' }] : path === '/private/tmp/tmux-501' ? [{ name: 'default' }, { name: 'claude-swarm-test' }] : [],
      read: async (path: string) => {
        if (!team) throw new Error('No team')
        if (path.endsWith('/config.json')) {
          if (configFailures > 0) { configFailures--; throw new Error('Team removed') }
          return JSON.stringify({ leadSessionId: 'test-session', members })
        }
        return JSON.stringify([{ from: 'peer', timestamp: inboxStamp, text: 'same inbox message' }])
      },
    },
    process: { run: async (argv: string[]) => {
      calls.push(argv)
      if (argv[0] === 'id') return { stdout: '501' }
      if (argv.includes('display')) return { stdout: '%3' }
      if (argv.includes('capture-pane')) {
        if (slowCapture) return new Promise<{ stdout: string }>(resolve => { releaseCapture = resolve })
        return { stdout: captureText }
      }
      return { stdout: '/home/test' }
    } },
    session: { id: async () => 'test-session' },
    ui: { status: () => {}, open: async () => { opened++ }, close: async () => {}, toast: async () => {} },
  }, { values, timers })
  register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
  const run = (name: string, event: unknown, next = async () => ({})) => handlers.get(name)!(engine, event, next)
  const state = (key: string) => values.get(JSON.stringify({ plugin: 'team-graph', key })) as any
  await run('session.start', {})
  await run('tool.call', { tool: 'Agent', input: { description: 'check UI' } }, async () => {
    agents = [{ id: 'sub-1', name: 'checker', type: 'general', status: 'running', description: 'check UI' }]
    return { agentId: 'sub-1' }
  })
  expect(opened).toBe(0) // the pane opens only through /team-graph
  expect(state('log')[0].text).toBe('task: check UI')
  await run('tool.call', { agentId: 'sub-1', tool: 'Read' })
  await new Promise(r => setTimeout(r, 0)) // subagent bookkeeping runs beside the tool
  expect(state('nodes')[0].tools).toBe(1)
  expect(state('nodes')[0].last).toBe('Read')
  now += 1000
  agents[0].status = 'completed'
  await run('turn.complete', { agentId: 'sub-1', answer: 'looks good\nextra details' })
  expect(state('nodes')[0].done).toBe(true)
  expect(state('nodes')[0].ended).toBe(now)
  expect(state('log').at(-1).text).toBe('looks good')
  agents[0].status = 'running'
  now += 1000
  await run('tool.call', { agentId: 'sub-1', tool: 'Bash' })
  await new Promise(r => setTimeout(r, 0)) // subagent bookkeeping runs beside the tool
  expect(state('nodes')[0].done).toBe(false)
  expect(state('nodes')[0].status).toBe('running')
  expect(state('nodes')[0].since).toBe(now)
  expect(state('nodes')[0].ended).toBe(undefined)
  const frame = state('frame')
  await timers.get(150)!()
  expect(state('frame')).toBe(frame)

  team = true
  now = 20000
  await timers.get(1000)!()
  expect(state('nodes').some((n: { name: string }) => n.name === 'checker')).toBe(true)
  expect(calls.some(argv => argv.includes('capture-pane'))).toBe(false)
  await run('command.run', {})
  slowCapture = true
  inboxStamp = 'second'
  const tick = timers.get(1000)!()
  for (let i = 0; i < 100 && (!releaseCapture || !state('log').some((m: { text: string }) => m.text === 'same inbox message')); i++) await Promise.resolve()
  expect(state('log').at(-1).text).toBe('same inbox message')
  expect(releaseCapture != null).toBe(true)
  releaseCapture!({ stdout: captureText })
  await tick
  slowCapture = false
  const peer = () => state('nodes').find((n: { name: string }) => n.name === 'peer')
  expect(peer().tools).toBe(2)
  expect(peer().last).toBe('checking output')
  captureText = '⏺ Read(file)'
  await timers.get(1000)!()
  expect(peer().tools).toBe(2)
  const captures = calls.filter(argv => argv.includes('capture-pane'))
  expect(captures[0].join(' ')).toBe('tmux -S /private/tmp/tmux-501/claude-swarm-test capture-pane -p -S -200 -t %3')
  expect(calls.some(argv => argv[0] === 'sh' || argv.includes(members[1].tmuxPaneId))).toBe(false)
  expect(calls.filter(argv => argv[0] === 'id').length).toBe(1)
  await run('command.run', { command: 'team-graph' })
  await run('command.run', { command: 'team-graph', args: '--motion off' })
  expect(state('motion')).toBe(false)
  expect(state('shown')).toBe(false)
  await run('command.run', { command: 'team-graph', args: '--motion on' })
  expect(state('motion')).toBe(true)
  expect(state('shown')).toBe(false)
  await run('command.run', { command: 'team-graph', args: '--motion maybe' })
  expect(state('motion')).toBe(true)
  const count = state('messageCount')
  inboxStamp = 'third'
  const beforeCapture = calls.filter(argv => argv.includes('capture-pane')).length
  await timers.get(1000)!()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(state('messageCount')).toBe(count + 1)
  expect(calls.filter(argv => argv.includes('capture-pane')).length).toBe(beforeCapture)
  configFailures = 3
  for (let i = 0; i < 3; i++) { now += 1000; await timers.get(1000)!() }
  await timers.get(1000)!()
  expect(peer().name).toBe('peer')
  const beforeReset = state('messageCount')
  await timers.get(1000)!()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(state('messageCount')).toBe(beforeReset + 1)
  expect(debugWrites).toBe(0)
  await run('session.start', {})
  expect(calls.filter(argv => argv[0] === 'printenv').length).toBe(0)
})

test('external AI jobs show live activity, concurrent names, and finish flights', async () => {
  const handlers = new Map<string, Function>()
  const values = new Map<string, unknown>()
  const timers = new Map<number, Function>()
  const files = new Map<string, { text: string; at: number }>()
  const dir = '/private/tmp/claude-501/project/external-session/tasks'
  let now = 100000
  let reads = 0
  const engine = fakeEngine({
    clock: { now: async () => now, },
    agent: { list: async () => [] },
    session: { id: async () => 'external-session' },
    fs: {
      list: async (path: string) => path === '/private/tmp/claude-501' ? [{ name: 'project', kind: 'dir' }] : path === '/private/tmp/claude-501/project' ? [{ name: 'external-session', kind: 'dir' }] : path === dir ? [...files].map(([name, file]) => ({ name, kind: 'file', mtimeMs: file.at, size: file.text.length })) : [],
      read: async () => { throw new Error('No team') },
    },
    process: { run: async (argv: string[]) => {
      if (argv[0] === 'id') return { stdout: '501' }
      const file = files.get(argv.at(-1)!.split('/').at(-1)!)
      if (!file) throw new Error('Missing output')
      if (argv[0] === 'tail') { reads++; expect(argv.slice(0, 3).join(' ')).toBe('tail -c 8192'); return { stdout: file.text.slice(-8192) } }
      throw new Error('Unexpected command')
    } },
  }, { values, timers })
  register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
  const run = (name: string, event: unknown, next: Function = async () => ({})) => handlers.get(name)!(engine, event, next)
  const state = (key: string) => values.get(JSON.stringify({ plugin: 'team-graph', key })) as any
  const tick = () => timers.get(1000)!()
  await run('session.start', {})
  await run('command.run', { command: 'team-graph' })
  await run('tool.call', { tool: 'Bash', command: 'codex exec "fix"' }, async () => {
    expect(state('nodes')?.[0]?.name).toBe('codex')
    expect(state('nodes')[0].done).toBe(false)
    expect(state('log')[0].text).toBe('task: codex exec "fix"')
    const graph = drawGraph(state('nodes'), 120, [], now, 0, false)
    expect(text(graph)).toContain('⬡ Codex')
    expect(graph.flat().some(s => s.c === '#a9b4c0' && s.t.includes('Codex'))).toBe(true)
    now += 12000
    expect(text(drawGraph(state('nodes'), 120, [], now))).toContain('⠋ 12s')
    now += 20000
    await tick()
    expect(state('nodes')[0].done).toBe(false)
    return { stdout: 'fixed', exit_code: 0 }
  })
  expect(state('nodes')[0].done).toBe(true)
  expect(state('log').at(-1).text).toBe('fixed')
  expect(state('flights').at(-1).to).toBe('main')
  await tick()
  expect(state('nodes')[0].name).toBe('codex')
  files.set('job.output', { text: '[codex] Running command: ls\n[codex] Command completed: ls (exit 0)', at: now })
  await run('tool.call', { tool: 'Bash', input: { command: 'node codex-companion.mjs', run_in_background: true } }, async () => ({ content: [{ type: 'text', text: `Output file: ${dir}/job.output` }] }))
  await tick()
  expect(state('nodes').length).toBe(2)
  expect(text(drawGraph(state('nodes'), 140, [], now))).toContain('Running ▸ ls')
  expect(state('nodes')[1].done).toBe(false)
  await run('tool.call', { tool: 'Bash', args: { command: 'codex exec second', run_in_background: true } }, async () => ({ text: `Output file: ${dir}/second.output` }))
  expect(state('nodes')[2].name).toBe('codex-3')
  files.set('second.output', { text: '[codex] Assistant message captured: repaired\n[codex] Turn completed.', at: now })
  await tick()
  expect(state('nodes').length).toBe(3)
  expect(state('nodes')[2].done).toBe(true)
  expect(state('log').at(-1).text).toBe('repaired')
  expect(text(drawGraph([state('nodes')[2]], 120, [], now))).toContain('✓ done')
  files.set('second.output', { text: '[codex] Turn completed.\n[exited with code 2]', at: now })
  await tick()
  expect(state('nodes')[2].status).toBe('failed')
  expect(text(drawGraph([state('nodes')[2]], 120))).toContain('✗ failed')
  files.set('second.output', { text: '[codex] Running command: ls\n[exited with code 143]', at: now })
  await tick()
  expect(state('nodes')[2].status).toBe('stopped')
  now += 20000
  await tick()
  expect(state('nodes')[1].done).toBe(false)
  now += 160000
  await tick()
  expect(state('nodes')[1].done).toBe(true)
  files.set('job.output', { text: '[codex] Running command: pwd', at: now })
  await tick()
  expect(state('nodes')[1].done).toBe(false)
  files.set('found.output', { text: '[codex] Assistant message captured: discovered', at: now })
  await tick()
  expect(state('nodes').at(-1).last).toBe('Says ▸ discovered')
  const before = reads
  await run('command.run', { command: 'team-graph' })
  await tick()
  expect(reads).toBe(before)
  await run('tool.call', { tool: 'Bash', command: 'gemini -p fix' }, async () => { throw new Error('interrupted') }).catch(() => {})
  expect(state('nodes').at(-1).status).toBe('stopped')
  await run('tool.call', { tool: 'Bash', command: 'gemini -p fix' }, async () => ({ deny: 'Permission denied' }))
  expect(state('nodes').at(-1).status).toBe('stopped')
  await run('tool.call', { tool: 'Bash', command: 'gemini -p fix' }, async () => ({ result: { stdout: 'partial', interrupted: true }, text: 'partial' }))
  expect(state('nodes').at(-1).status).toBe('stopped')
  for (const command of ['opencode run fix', 'amp fix', 'kimi fix', 'copilot fix', 'claude -p fix']) {
    await run('tool.call', { tool: 'Bash', command }, async () => ({ result: { stdout: '', stderr: 'boom' }, text: 'boom', isError: true }))
    expect(state('nodes').at(-1).name).toBe(command.split(' ')[0])
    expect(state('nodes').at(-1).status).toBe('failed')
  }
  await run('tool.call', { tool: 'Bash', command: 'gemini -p fix', run_in_background: true }, async () => ({ is_error: true, text: 'launch failed' }))
  expect(state('nodes').at(-1).status).toBe('failed')
  expect(state('log').at(-1).text).toBe('launch failed')
  const count = state('nodes').length
  await run('tool.call', { tool: 'Bash', command: 'codex exec slow' }, async () => ({ result: { stdout: '', backgroundTaskId: 'b1', timedOutAfterMs: 120000 }, text: `Output file: ${dir}/slow.output` }))
  expect(state('nodes').length).toBe(count + 1)
  expect(state('nodes').at(-1).done).toBe(false)
  files.set('slow.output', { text: '[codex] Running command: ls', at: now })
  await tick()
  expect(state('nodes').length).toBe(count + 1)
})

test('only commands that run an AI CLI count, not ones that mention it', () => {
  expect(providerOf('codex exec "fix it"')).toBe('codex')
  expect(providerOf('cd x && GEMINI_KEY=1 gemini -p hi')).toBe('gemini')
  expect(providerOf('node ~/.claude/plugins/x/codex-companion.mjs task')).toBe('codex')
  expect(providerOf('claude -p "summarise"')).toBe('claude')
  expect(providerOf('grep -n "codex" register.tsx')).toBe(undefined)
  expect(providerOf('cat notes/gemini.md | wc -l')).toBe(undefined)
  expect(providerOf('claude plugin validate .')).toBe(undefined)
})

test('subagent actions show their command', () => {
  expect(actionOf('Bash', { command: 'sleep 4; echo hi\nmore' })).toBe('Bash(sleep 4; echo hi)')
  expect(actionOf('Read', { file_path: 'a.ts' })).toBe('Read(a.ts)')
  expect(actionOf('Task', {})).toBe('Task')
})

test('codex commands drop their shell wrapper', () => {
  expect(unshell("/bin/zsh -lc 'rg -n consumersFilter pages/'")).toBe('rg -n consumersFilter pages/')
  expect(unshell('/bin/bash -c "npm test"')).toBe('npm test')
  expect(unshell("/bin/zsh -lc \"python3 - <<'PY' from x...")).toBe("python3 - <<'PY' from x...")
  expect(unshell('ls -la')).toBe('ls -la')
})

test('a box straight above the orchestrator joins its top edge, and long paths are shortened', () => {
  const two = [list[0], list[1]]
  const out = text(drawGraph(two, 80, [], 0, 0, false))
  expect(out).toContain('┴')
  expect(out).toContain('┬')
  expect(out).not.toContain('├')
  expect(shortPaths('cat /private/tmp/claude-502/-Users-x/abc/tasks/x.output')).toBe('cat …/tasks/x.output')
  expect(shortPaths('ls src/a.ts')).toBe('ls src/a.ts')
})

test('the theme can be picked with a flag or a bare word', () => {
  expect(themeArg('--theme retro')).toBe('retro')
  expect(themeArg('--theme=retro')).toBe('retro')
  expect(themeArg('-t classic')).toBe('classic')
  expect(themeArg('retro')).toBe('retro')
  expect(themeArg('')).toBe(undefined)
  expect(themeArg('--theme neon')).toBe('neon')
  expect(themeArg('--theme vapor')).toBe(undefined)
})

test('retro theme colours boxes by state and shows a gradient progress bar', () => {
  const rows = drawGraph(list, 120, [], 0, 0, false, 'retro')
  const out = retro(rows)
  const flat = out.flat()
  expect(progressBar(2, 4, 12)).toBe('██████░░░░░░')
  expect(text(out)).toContain('████░░░░ 2/4')
  expect(flat.some(s => s.c === '#7ee787')).toBe(true)   // done
  expect(flat.some(s => s.c === '#ffb454')).toBe(true)   // running
  expect(flat.some(s => s.t.includes('█') && s.c !== '#a78bfa')).toBe(true) // gradient, not flat
  expect(text(out).split('\n').map(l => [...l].length)).toEqual(text(rows).split('\n').map(l => [...l].length))
  expect(themeArg('--theme c2ms')).toBe(undefined)
})

test('the graph grows to the height asked for and status checks are not Codex jobs', () => {
  const tall = drawGraph(list, 120, [], 0, 0, false, 'classic', 17)
  expect(tall.length).toBe(17)
  expect(text(tall)).toContain('◆ Main')
  expect(providerOf('node x/codex-companion.mjs status 2>&1')).toBe(undefined)
  expect(providerOf('node x/codex-companion.mjs task --write "fix"')).toBe('codex')
  expect(providerOf('node x/codex-companion.mjs task-resume-candidate --json')).toBe(undefined)
})

test('quoted pipes, version checks and logins are not Codex jobs', () => {
  expect(providerOf('ls hooks; grep -rnE "Codex|codex|failed" hooks')).toBe(undefined)
  expect(providerOf("grep -E 'x|codex exec' f")).toBe(undefined)
  expect(providerOf('which codex; codex --version')).toBe(undefined)
  expect(providerOf('codex login')).toBe(undefined)
  expect(providerOf('codex exec "a|b" && echo ok')).toBe('codex')
})

test('an empty graph and bus say so instead of looking broken', () => {
  expect(text(drawGraph([], 100))).toContain('No agents yet')
  const bus = drawBus([], [], 60, 0, 0, [])
  expect(bus.map(r => r.map(s => s.t).join('')).join('\n')).toContain('No messages yet')
})

test('the sparkline carries a dim activity label when the bus is wide enough', () => {
  const head = (w: number) => drawBus([], [], w, 0, 0, [])[0].map(s => s.t).join('')
  expect(head(80)).toContain(' Activity ')
  expect([...head(60)].length).toBe(60)
  expect(head(40)).not.toContain('Activity')
})

test('retro shows a walking robot with the running count under the progress bar only while agents run', () => {
  const out = retro(drawGraph(list, 120, [], 0, 1, false, 'retro', 11, { enabled: true }, 'plain'))
  const lines = text(out).split('\n')
  const barRow = lines.findIndex(l => l.includes('█') || l.includes('░'))
  const body = lines[barRow + 1]
  expect(lines[barRow]).not.toContain('running')
  expect(body).toContain('running')
  expect(body).toMatch(/\[[•-]_[•-]\]/)
  expect(out.flat().some(s => s.c === '#c8c2b5' && s.t.includes('_'))).toBe(true)
  const idle = list.map(n => ({ ...n, done: true, status: 'idle', since: 0 }))
  expect(text(drawGraph(idle, 120, [], 0, 1, false, 'retro', 11, { enabled: true }, 'plain'))).not.toContain('running')
  expect(text(drawGraph(idle, 120, [], 0, 1, false, 'retro', 11, { enabled: true }, 'plain'))).toContain('\\[^_^]/ All done')
  expect(text(drawGraph(list, 120, [], 0, 1, false, 'classic'))).not.toContain(' running')
})

test('orchestrator checks on Codex jobs are not new Codex jobs', () => {
  const S = 'S=~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs;'
  expect(providerOf(`export PATH=x; ${S} until ! node "$S" status 2>/dev/null | grep -q task-m; do sleep 20; done`)).toBe(undefined)
  expect(providerOf(`export PATH=x; ${S} J=$(node "$S" status 2>&1 | grep -oE 'task-[a-z0-9]+')`)).toBe(undefined)
  expect(providerOf('node ~/x/codex-companion.mjs cancel task-muraifd2-k5879o 2>&1 | tail -3')).toBe(undefined)
  expect(providerOf(`${S} node "$S" task --background --write "fix F1"`)).toBe('codex')
  expect(providerOf('node ~/x/codex-companion.mjs review --wait')).toBe('codex')
})

test('agent names are drawn with a capital first letter', () => {
  const out = text(drawGraph(list, 120))
  expect(out).toContain('Frontend')
  expect(out).not.toMatch(/─frontend/)
  const bus = drawBus(list, [{ at: 0, from: 'frontend', to: 'team-lead', text: 'hi' }], 80, 0, 1, [])
  expect(bus.map(r => r.map(s => s.t).join('')).join('\n')).toContain('Frontend')
})

test('nothing ticks while idle: no bus timer and no spinner without agents', () => {
  const head = drawBus([], [{ at: 0, from: 'a', to: 'main', text: 'x' }], 80, 9000000, 1, [])[0].map(s => s.t).join('')
  expect(head).not.toMatch(/\d+m\d+s/)
  const empty = text(drawGraph([], 100, [], 0, 3, false, 'retro'))
  expect(empty).not.toMatch(/[⣾⣽⣻⢿⡿⣟⣯⣷]/)
  expect(text(drawGraph([], 100, [], 0, 3))).toContain('Idle')
})


test('opening sweeps left to right with a gradient and preserves display columns', () => {
  for (const look of ['classic', 'retro']) {
    const draw = (now: number) => drawGraph(list, 120, [], now, 0, true, look, 11, { enabled: true, opened: 1000 })
    expect(text(draw(1000)).trim()).toBe('')
    const half = draw(1200)
    expect(text(half)).toContain('Frontend')
    expect(text(half)).not.toContain('Backend')
    expect(half.flat().some(s => s.c?.startsWith('#'))).toBe(true)
    for (const row of half) expect(displayWidth(row.map(s => s.t).join(''))).toBe(120)
    expect(draw(1400)).toEqual(drawGraph(list, 120, [], 1400, 0, true, look, 11, { enabled: true }))
  }
})

test('completion fades border and text for 600 ms in both themes', () => {
  const done = [{ ...list[0], status: 'completed', done: true, ended: 1000 }]
  for (const look of ['classic', 'retro']) {
    const draw = (now: number, enabled = true) => drawGraph(done, 80, [], now, 0, true, look, 11, { enabled })
    const titleColor = (rows: ReturnType<typeof drawGraph>) => rows.flat().find(s => s.t.includes('Frontend'))?.c
    expect(titleColor(draw(1000))).toBe(look === 'retro' ? '#ffb454' : 'blue')
    expect(titleColor(draw(1300))).not.toBe(titleColor(draw(1000)))
    expect(titleColor(draw(1300))).not.toBe(titleColor(draw(1600)))
    expect(titleColor(draw(1600))).toBe(look === 'retro' ? '#7ee787' : 'gray')
    expect(draw(1000, false)).toEqual(draw(1600, false))
  }
})

test('only running routes shift hue, travelling toward the orchestrator', () => {
  for (const look of ['classic', 'retro']) {
    const lines = (ns: typeof list, now: number, enabled = true) => drawGraph(ns, 120, [], now, 0, true, look, 11, { enabled }).flat().filter(s => /[╌╎╭╮╰╯]/.test(s.t))
    expect(lines(list, 1000)).not.toEqual(lines(list, 1800))
    expect(lines(list, 1000, false)).toEqual(lines(list, 1800, false))
    const idle = list.map(n => ({ ...n, status: 'idle', done: true }))
    expect(lines(idle, 1000)).toEqual(lines(idle, 1800))
  }
})


test('job discovery respects TMPDIR and falls back to macOS and Linux roots', async () => {
  for (const [tmp, root] of [['/custom/tmp/', '/custom/tmp'], ['', '/tmp'], ['/missing', '/private/tmp'], ['relative', '/tmp']]) {
    const handlers = new Map<string, Function>(), values = new Map<string, unknown>()
    const timers = new Map<number, Function>(), calls: string[][] = [], searched: string[] = []
    const sid = 'portable-' + root.replace(/\//g, '-') + tmp.replace(/\//g, '-')
    const tasks = `${root}/claude-501/project/${sid}/tasks`
    const engine = fakeEngine({
      env: { get: async (name: string) => name === 'TMPDIR' ? tmp : name === 'HOME' ? '/home/test' : undefined },
      clock: { now: async () => 100000, },
      session: { id: async () => sid }, agent: { list: async () => [] },
      fs: {
        list: async (path: string) => {
          searched.push(path)
          if (path === `${root}/claude-501`) return [{ name: 'project', kind: 'dir' }]
          if (path === `${root}/claude-501/project`) return [{ name: sid, kind: 'dir' }]
          if (path === tasks) return [{ name: 'portable.output', kind: 'file', mtimeMs: 100000, size: 20 }]
          return []
        },
        read: async () => { throw new Error('No team') }, write: async () => {},
      },
      process: { run: async (argv: string[]) => {
        calls.push(argv)
        if (argv[0] === 'id') return { stdout: '501' }
        if (argv[0] === 'tail') return { stdout: '[codex] Running command: portable' }
        throw new Error('Unexpected command')
      } },
    }, { values, timers })
    register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
    await handlers.get('session.start')!(engine, {}, async () => ({}))
    await handlers.get('command.run')!(engine, { command: 'team-graph' })
    await timers.get(1000)!()
    const ns = values.get(JSON.stringify({ plugin: 'team-graph', key: 'nodes' })) as typeof list & { output: string }[]
    expect(ns.at(-1)?.output).toBe(`${tasks}/portable.output`)
    expect(ns.at(-1)?.last).toBe('Running ▸ portable')
    expect(calls.some(a => a[0] === 'stat' || a[0] === 'printenv')).toBe(false)
    if (tmp === '/custom/tmp/') expect(searched[searched.indexOf('/custom/tmp/claude-501') + 1]).toBe('/custom/tmp/claude-501/project')
  }
})


test('easing clamps elapsed time and colour transforms preserve exact endpoints', () => {
  expect(easeInOutCubic(-1)).toBe(0)
  expect(easeInOutCubic(0.25)).toBe(0.0625)
  expect(easeInOutCubic(0.5)).toBe(0.5)
  expect(easeInOutCubic(0.75)).toBe(0.9375)
  expect(easeInOutCubic(2)).toBe(1)
  expect(easeOutCirc(0)).toBe(0)
  expect(easeOutCirc(1)).toBe(1)
  expect(fadeColor('blue', 'gray', 0)).toBe('blue')
  expect(fadeColor('blue', 'gray', 1)).toBe('gray')
  expect(fadeColor('#000000', '#ffffff', 0.5)).toBe('#808080')
  expect(hueShift('#ff0000', 120)).toBe('#00ff00')
  expect(hueShift('#ff0000', -120)).toBe('#0000ff')
  expect(hueShift('#808080', 120)).toBe('#808080')
})

test('hue phase moves one route cell toward the orchestrator in one twelfth of a cycle', () => {
  const ns = [{ ...list[0], status: 'running' }, { ...list[1], status: 'idle', done: true }, { ...list[2], status: 'idle', done: true }]
  const colour = (now: number, y: number) => {
    const row = drawGraph(ns, 120, [], now, 0, true, 'classic', 11, { enabled: true })[y]
    let x = 0
    for (const s of row) { x += displayWidth(s.t); if (x > 30) return s.c }
  }
  // Route begins at (30, 3), then (30, 4), then heads right toward the central box.
  expect(colour(1000, 3)).toBe(colour(1000 + 4000 / 12, 4))
  expect(colour(1000, 3)).not.toBe(colour(1000 + 4000 / 12, 3))
})

test('effects stop exactly after the last opening, fade or message deadline', () => {
  const done = [{ ...list[0], status: 'completed', done: true, ended: 1000 }]
  expect(effectsActive([], [], 1399, 1000)).toBe(true)
  expect(effectsActive([], [], 1400, 1000)).toBe(false)
  expect(effectsActive(done, [], 1599, -1)).toBe(true)
  expect(effectsActive(done, [], 1600, -1)).toBe(false)
  expect(effectsActive([], [{ from: 'a', to: 'b', at: 1000 }], 3499, -1)).toBe(true)
  expect(effectsActive([], [{ from: 'a', to: 'b', at: 1000 }], 3500, -1)).toBe(false)
  expect(effectsActive(list, [], 100000, -1)).toBe(true)
})

test('animation renders the final frame, does no idle engine I/O, and keeps motion off across reloads', async () => {
  const handlers = new Map<string, Function>(), values = new Map<string, unknown>(), timers = new Map<number, Function>()
  let now = 1000, reads = 0, writes = 0
  const key = (name: string) => JSON.stringify({ plugin: 'team-graph', key: name })
  values.set(key('nodes'), [{ ...list[0], done: true, status: 'completed', ended: 1000 }])
  const engine = fakeEngine({
    state: {
      get: async (key: unknown) => { reads++; return { value: values.get(JSON.stringify(key)) } },
      set: async (key: unknown, value: unknown) => { writes++; values.set(JSON.stringify(key), value); return { isSet: true } },
    },
    clock: { now: async () => now, },
  }, { values, timers })
  register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
  const start = () => handlers.get('session.start')!(engine, {}, async () => ({}))
  const command = (args = '') => handlers.get('command.run')!(engine, { command: 'team-graph', args })
  await start()
  await command()
  expect(values.get(key('openedAt'))).toBe(1000)
  await timers.get(40)!()
  now = 1600
  const frame = Number(values.get(key('frame')))
  await timers.get(40)!()
  expect(values.get(key('frame'))).toBe(frame + 1)
  const idleReads = reads, idleWrites = writes
  now = 2000
  await timers.get(40)!()
  await timers.get(150)!()
  expect(reads).toBe(idleReads)
  expect(writes).toBe(idleWrites)
  await command('--motion off')
  await start()
  expect(values.get(key('motion'))).toBe(false)
  const frozenFrame = values.get(key('frame'))
  const offReads = reads
  await timers.get(40)!()
  await timers.get(150)!()
  expect(values.get(key('frame'))).toBe(frozenFrame)
  expect(reads).toBe(offReads)
  await command('--motion on')
  expect(values.get(key('motion'))).toBe(true)
  await command()
  await command('--theme retro')
  expect(values.get(key('shown'))).toBe(true)
  expect(values.get(key('openedAt'))).toBe(2000)
})

test('untrusted text loses terminal escapes and control characters', () => {
  expect(clean('ok\x1b[31mred\x1b[0m')).toBe('okred')
  expect(clean('a\x1b]0;title\x07b')).toBe('ab')
  expect(clean('x\x1b]8;;http://e\x1b\\y')).toBe('xy')
  expect(clean('tab\tnew\nline\x07bell')).toBe('tab\tnew\nlinebell')
  expect(clean('Bash ▸ npm run lint')).toBe('Bash ▸ npm run lint')
})

test('every agent status has a colour-independent state glyph in both themes', () => {
  for (const look of ['classic', 'retro']) {
    for (const [status, done, glyph] of [['running', false, '●'], ['completed', true, '✓'], ['failed', true, '✗'], ['killed', true, '✗'], ['pending', false, '○'], ['idle', false, '○'], ['idle', true, '✓']] as const) {
      for (const width of [12, 32, 80]) {
        const rows = drawGraph([{ ...list[0], name: 'A very long name', status, done }], width, [], 0, 0, false, look)
        expect(text([rows[0]])).toContain(glyph)
        for (const row of rows) expect(displayWidth(row.map(s => s.t).join(''))).toBe(width)
      }
    }
  }
})

test('bus age uses three fixed brightness levels in both themes', () => {
  const messages = Array.from({ length: 7 }, (_, at) => ({ at, from: 'frontend', to: 'main', text: 'Message' }))
  const rows = drawBus(list, messages, 80, 60000, 7, []).slice(2)
  for (const themed of [rows, retro(rows)]) {
    expect(themed[6].some(s => s.d)).toBe(false)
    expect(themed[5].every(s => s.d)).toBe(true)
    expect(themed[0].every(s => s.d)).toBe(true)
    expect(themed[0].at(-1)!.c).not.toBe(themed[5].at(-1)!.c)
    expect(themed[0]).toEqual(themed[1])
    expect(themed[4]).toEqual(themed[5])
  }
})

test('narrow retro panes hide labels and robot tracks while retaining clipped names', () => {
  for (const width of [25, 32, 47, 69]) {
    const rows = drawGraph([{ ...list[0], name: 'An exceptionally long agent name that exceeds every tested pane width' }], width, [], 0, 15, false, 'retro')
    expect(text(rows)).toContain(width >= 40 ? '● ●' : '[● ●]')
    expect(text(rows)).not.toContain('·[●')
    expect(text([rows[0]])).toContain('…')
    expect(text(drawBus([], [], width, 0, 0, []))).not.toContain('Activity')
    for (const row of rows) expect(displayWidth(row.map(s => s.t).join(''))).toBe(width)
  }
})

test('disabled motion stays static and still cheers after completion', () => {
  for (const width of [32, 80, 120]) {
    const agents = [{ ...list[0], status: 'completed', done: true }]
    const draw = (tick: number) => drawGraph(agents, width, [], 1000, tick, false, 'retro', 11, { enabled: false }, 'plain')
    expect(draw(0)).toEqual(draw(24))
    expect(text(draw(24))).toContain('\\[^_^]/')
  }
})


test('motion preference obeys the viewport boundary and NO_MOTION', () => {
  expect(motionEnabled(true, 19, false)).toBe(false)
  expect(motionEnabled(true, 20, false)).toBe(true)
  expect(motionEnabled(true, 30, true)).toBe(false)
  expect(motionEnabled(false, 30, false)).toBe(false)
})

test('active route hue stays within 25 degrees of its state colour', () => {
  const agents = [{ ...list[0], status: 'running' }, { ...list[1], status: 'idle', done: true }, { ...list[2], status: 'idle', done: true }]
  for (const look of ['classic', 'retro']) {
    for (const now of [1000, 3000]) {
      const row = drawGraph(agents, 120, [], now, 0, true, look, 11, { enabled: true })[3]
      let x = 0
      const line = row.find(s => { x += displayWidth(s.t); return x > 30 })!
      expect(line.c).toBe(hueShift(look === 'retro' ? '#ffb454' : 'blue', now === 1000 ? 25 : -25))
    }
  }
})


test('pane rendering greys the full clickable divider and freezes short viewports', async () => {
  const handlers = new Map<string, Function>(), values = new Map<string, unknown>(), timers = new Map<number, Function>()
  let now = 1000
  const key = (name: string) => JSON.stringify({ plugin: 'team-graph', key: name })
  values.set(key('nodes'), [{ ...list[0], done: true, status: 'completed', ended: 1000 }])
  const engine = fakeEngine({
    clock: { now: async () => now, },
  }, { values, timers })
  register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
  await handlers.get('session.start')!(engine, {}, async () => ({}))
  await handlers.get('command.run')!(engine, { command: 'team-graph', args: '--motion on' })
  const render = (columns: number, rows: number) => handlers.get('ui.render')!(engine, { props: { bodyColumns: columns }, viewport: { columns, rows } }, async () => ({}))
  const buttons = (tree: unknown): any[] => {
    if (!tree || typeof tree !== 'object') return []
    const value = tree as any
    return [...(value.props?.key?.startsWith('graph-') ? [value] : []), ...Object.values(value).flatMap(buttons)]
  }
  for (const look of ['classic', 'retro']) {
    values.set(key('theme'), look)
    for (const columns of [8, 34, 69, 80]) {
      const controls = buttons(await render(columns, 30))
      expect(controls.length).toBe(4)
      const labels = controls.filter(c => !c.props.hotkey).map(c => c.props.label).join('')
      expect(labels).toContain(columns > 18 ? 'k ▲ resize ▼ j' : 'k ▲')
      expect(displayWidth(labels)).toBe(columns - 2)
      expect(controls.every(c => c.props.dimColor === true)).toBe(true)
      expect(controls.filter(c => c.props.hotkey).map(c => c.props.hotkey)).toEqual(['k', 'j'])
      await controls[0].onPress()
      const smaller = values.get(key('graphRows')) as number
      await controls[1].onPress()
      expect(values.get(key('graphRows'))).toBe(Math.min(40, smaller + 4))
    }
  }
  values.set(key('theme'), 'retro')
  const snapshot = (tree: unknown) => JSON.stringify(tree, (key, value) => key === 'press' ? undefined : value)
  const frozen = await render(80, 19)
  expect(JSON.stringify(frozen)).toContain('^   ^')
  const before = values.get(key('frame'))
  now = 1300
  await timers.get(40)!()
  await timers.get(150)!()
  expect(values.get(key('frame'))).toBe(before)
  expect(snapshot(await render(80, 19))).toBe(snapshot(frozen))
  await render(80, 20)
  await timers.get(40)!()
  expect(values.get(key('frame'))).not.toBe(before)
})


test('idle teammates without prior work remain pending even when the config marks them done', () => {
  const idle = [{ ...list[0], status: 'idle', tools: 0, last: '', done: true }]
  for (const look of ['classic', 'retro']) {
    const out = text(drawGraph(idle, 80, [], 0, 0, false, look))
    expect(out).toContain('○ idle')
    expect(out).toContain('◆ Main 0/1')
    expect(out).not.toContain('All done')
  }
})

test('the cheering robot shows when all are done, even with motion paused', () => {
  const idle = list.map(n => ({ ...n, done: true, status: 'completed' }))
  for (const look of ['retro'])
    expect(text(drawGraph(idle, 120, [], 0, 1, false, look, 11, { enabled: false }, 'plain'))).toContain('\\[^_^]/ All done')
})


test('default retro head shows state eyes and keeps the gradient beside its outline', () => {
  const draw = (agents = list) => retro(drawGraph(agents, 120, [], 0, 0, false, 'retro'))
  expect(text(draw())).toContain('╭─────────╮ ████░░░░ 2/4')
  expect(text(draw())).toContain('│  ●   ●  │ 2 running')
  expect(draw().flat().some(s => s.c === '#c8c2b5' && s.t.includes('╭─────────╮'))).toBe(true)
  expect(draw().flat().some(s => s.c === '#5af78e' && s.t.includes('●   ●'))).toBe(true)
  expect(text(draw(list.map(n => ({ ...n, status: 'completed', done: true }))))).toContain('│  ^   ^  │ All done')
  for (const agents of [[], [{ ...list[0], status: 'idle', done: false }]]) {
    const rows = draw(agents)
    expect(text(rows)).toContain('│  −   −  │')
    expect(rows.flat().some(s => s.c === '#8b949e' && s.t.includes('−   −'))).toBe(true)
  }
  const failed = draw([{ ...list[0], status: 'failed', done: true }])
  expect(text(failed)).toContain('│  ×   ×  │')
  expect(failed.flat().some(s => s.c === '#ff6b6b' && s.t.includes('×   ×'))).toBe(true)
  expect(text(draw([{ ...list[0], status: 'failed', done: true }, list[2]]))).toContain('│  ●   ●  │')
})

test('head glances slowly, blinks periodically, and double blinks on lead arrival', () => {
  const draw = (tick: number, now = 0, to = '') => text(drawGraph(list, 120, to ? [{ from: 'frontend', to, at: 0 }] : [], now, tick, false, 'retro', 15, { enabled: true }))
  expect(draw(0)).toContain('│  ●   ●  │')
  expect(draw(1)).toContain('│  ●   ●  │')
  expect(draw(3)).toContain('│ ●   ●   │')
  expect(draw(9)).toContain('│   ●   ● │')
  expect(draw(21)).toContain('│  ━   ━  │')
  for (const to of ['main', 'orchestrator']) {
    expect(draw(0, 1800, to)).toContain('│  ━   ━  │')
    expect(draw(0, 1950, to)).toContain('│  ●   ●  │')
    expect(draw(0, 2100, to)).toContain('│  ━   ━  │')
    expect(draw(0, 2250, to)).toContain('│  ●   ●  │')
    expect(draw(0, 2400, to)).toContain('│  ●   ●  │')
  }
  expect(draw(0, 1800, 'backend')).toContain('│  ●   ●  │')
})

test('head stays static without motion and uses a narrow fallback without overflow', () => {
  for (const width of [7, 12, 25, 69, 70, 120]) {
    const draw = (tick: number) => drawGraph(list, width, [{ from: 'frontend', to: 'main', at: 0 }], 1800, tick, false, 'retro', 15, { enabled: false })
    expect(draw(0)).toEqual(draw(21))
    if (width >= 25 && width < 40) expect(text(draw(21))).toContain('[● ●] 2 running')
    if (width >= 40 && width < 70) expect(text(draw(21))).toContain('│  ● ●  │ 2 running')
    if (width >= 70) expect(text(draw(21))).toContain('│  ●   ●  │')
    for (const row of draw(21)) expect(displayWidth(text([row]))).toBe(width)
  }
})

test('head completion stays static without motion and responds to landed messages with motion', () => {
  const agents = list.map(n => ({ ...n, status: 'completed', done: true }))
  const flight = [{ from: 'frontend', to: 'main', at: 0 }]
  const draw = (enabled: boolean, now: number, tick: number) => text(drawGraph(agents, 120, flight, now, tick, false, 'retro', 15, { enabled }))
  expect(draw(false, 1800, 0)).toBe(draw(false, 1800, 21))
  expect(draw(false, 1800, 21)).toContain('│  ^   ^  │')
  expect(draw(true, 1800, 0)).toContain('│  ━   ━  │')
  expect(draw(true, 1950, 0)).toContain('│  ^   ^  │')
  expect(draw(true, 2100, 0)).toContain('│  ━   ━  │')
  expect(draw(true, 2400, 0)).toContain('│  ^   ^  │')
})

test('head bottom routes join the taller centre border', () => {
  for (const height of [11, 15, 19]) {
    const rows = drawGraph(list.slice(0, 2), 120, [], 0, 0, false, 'retro', height)
    const lines = text(rows).split('\n')
    const headBottom = lines.findIndex(l => l.includes('╰─────────╯'))
    expect(lines[headBottom + 1][60]).toBe('┬')
    expect(lines[headBottom][60]).toBe(' ')
    expect(lines[Math.floor(height / 2) - 2][60]).toBe('┴')
  }
})


test('robot flags persist across reloads, render the saved style, and reject unknown values', async () => {
  const handlers = new Map<string, Function>(), values = new Map<string, unknown>()
  const key = (name: string) => JSON.stringify({ plugin: 'team-graph', key: name })
  values.set(key('nodes'), list)
  const engine = fakeEngine({
    clock: { now: async () => 10000 },
  }, { values })
  const load = async () => {
    register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
    await handlers.get('session.start')!(engine, {}, async () => ({}))
  }
  const command = (args: string) => handlers.get('command.run')!(engine, { command: 'team-graph', args })
  const render = async () => JSON.stringify(await handlers.get('ui.render')!(engine, { props: { bodyColumns: 100 }, viewport: { columns: 100, rows: 19 } }, async () => ({})))
  await load()
  expect(await render()).toContain('╭─────────╮')
  const shown = values.get(key('shown'))
  expect((await command('--robot plain')).text).toBe('Robot plain.')
  expect(values.get(key('robotStyle'))).toBe('plain')
  expect(values.get(key('shown'))).toBe(shown)
  await load()
  expect(values.get(key('robotStyle'))).toBe('plain')
  expect(await render()).toContain('[•_•]')
  expect((await command('--robot=head')).text).toBe('Robot head.')
  expect(values.get(key('robotStyle'))).toBe('head')
  expect(await render()).toContain('╭─────────╮')
  for (const args of ['--robot unknown', '--robot=', '--robot']) {
    expect((await command(args)).text).toBe('Unknown robot. Pick one of: head, plain.')
    expect(values.get(key('robotStyle'))).toBe('head')
  }
  values.set(key('owner'), { id: 'another-owner', beat: 10000 })
  await command('--robot plain')
  expect(values.get(key('robotStyle'))).toBe('head')
})

test('classic rendering is unchanged by robot style', () => {
  expect(drawGraph(list, 120, [], 0, 21, false, 'classic', 11, { enabled: true }, 'head'))
    .toEqual(drawGraph(list, 120, [], 0, 21, false, 'classic', 11, { enabled: true }, 'plain'))
})

test('narrow panes draw a small boxed head; wide panes the full one', () => {
  const narrow = text(drawGraph([list[0]], 60, [], 0, 0, false, 'retro', 15))
  expect(narrow).toContain('╭───────╮')
  expect(narrow).toContain('│  ● ●  │')
  const wide = text(drawGraph([list[0]], 120, [], 0, 0, false, 'retro', 15))
  expect(wide).toContain('╭─────────╮')
  expect(wide).toContain('│  ●   ●  │')
})

test('with the head, the centre box hugs its content instead of taking a third of the width', () => {
  const rows = drawGraph([list[0]], 160, [], 0, 0, false, 'retro', 15)
  const line = text(rows).split('\n').find(l => l.includes('◆ Main'))!
  const width = line.trim().length
  expect(width).toBeLessThan(40)
})

test('only commands that run the Codex helper with node count, not ones that search for it', () => {
  expect(providerOf('pgrep -fl "codex-companion.mjs task" | head')).toBe(undefined)
  expect(providerOf('grep -rn "codex-companion.mjs review" .')).toBe(undefined)
  expect(providerOf('node "/x/scripts/codex-companion.mjs" task "investigate"')).toBe('codex')
  expect(providerOf('S=/x/codex-companion.mjs; node "$S" task --background "fix"')).toBe('codex')
})

test('the Main box shows what the main session itself is doing, then goes quiet', () => {
  const busy = text(drawGraph([], 120, [], 5000, 0, false, 'retro', 15, { enabled: false }, 'head', { last: 'Bash(npm test)', at: 4000 }))
  expect(busy).toContain('Bash ▸ npm test')
  expect(busy).toContain('●   ●')
  const quiet = text(drawGraph([], 120, [], 20000, 0, false, 'retro', 15, { enabled: false }, 'head', { last: 'Bash(npm test)', at: 4000 }))
  expect(quiet).not.toContain('npm test')
})

test('centre box bounces up with happy eyes right after a subagent finishes', () => {
  const finished = [{ id: 'a@s', name: 'a', status: 'completed', tools: 1, last: '', done: true, since: 0, ended: 1000 },
    { id: 'b@s', name: 'b', status: 'running', tools: 1, last: '', done: false, since: 0 }]
  const headRow = (rows: { t: string }[][]) => rows.findIndex(r => r.map(s => s.t).join('').includes('╭───'))
  const at = (now: number) => drawGraph(finished, 80, [], now, 0, false, 'retro', 20, { enabled: true }, 'head')
  const rest = headRow(at(5000))
  expect(headRow(at(1000))).toBe(rest - 1)
  expect(headRow(at(1200))).toBe(rest)
  expect(text(at(1000))).toContain('^')
  expect(headRow(drawGraph(finished, 80, [], 1000, 0, false, 'retro', 20, { enabled: false }, 'head'))).toBe(rest)
})

test('a foreground codex exec box follows the log it redirects to', () => {
  expect(logPathOf('D=/tmp/s/ship; sed -i x "$D/state.md"; codex exec -C . "do it" < /dev/null > "$D/codex-build.log" 2>&1')).toBe('/tmp/s/ship/codex-build.log')
  expect(logPathOf('codex exec "x" 2>&1 | tee -a /tmp/a.log')).toBe('/tmp/a.log')
  expect(logPathOf('codex exec "x" > /dev/null')).toBe(undefined)
  expect(logPathOf('codex exec "x" > $UNSET/a.log')).toBe(undefined)
  expect(logPathOf('codex exec "x"')).toBe(undefined)
})

test('plain codex exec logs show the latest command, message and final answer', () => {
  const head = 'OpenAI Codex v0.165.0\nuser\nTask\ncodex\nI will read the pattern.\nexec\n'
  const running = rawCodexProgress(`${head}\x1b[1m/bin/zsh -lc 'npx tsc --noEmit'\x1b[0m in /Users/x/repo\n`)
  expect(running).toEqual({ last: 'Running ▸ npx tsc --noEmit', answer: undefined, finished: false })
  const done = rawCodexProgress(`${head}/bin/zsh -lc ls in /r\n exited 0 in 9ms:\ncodex\nFiles written.\n\nNo tests run.\ntokens used\n29,051\nFiles written.\n`)
  expect(done.finished).toBe(true)
  expect(done.answer).toBe('Files written. No tests run.')
  expect(done.last).toBe('Says ▸ Files written.')
})
