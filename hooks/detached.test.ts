import { expect, test } from 'claude-code/testing'
import { fakeEngine } from './fake-engine'
import { detachedJobs, jobLabel, providerOf, register, segmentsOf } from './register'

test('a lone & detaches a segment; redirects and && do not', () => {
  expect(segmentsOf('a > x 2>&1 & b &>y; c && d')).toEqual([
    { text: 'a > x 2>&1', detached: true },
    { text: 'b &>y', detached: false },
    { text: 'c', detached: false },
    { text: 'd', detached: false },
  ])
  expect(segmentsOf('codex exec "x & y; z" &')).toEqual([{ text: 'codex exec "x & y; z"', detached: true }])
})

test('detached CLI jobs are found with their -o file and log, variables expanded', () => {
  const S = '/s/scratch'
  const jobs = detachedJobs(`S=${S}; cd $S\nnohup codex exec -s read-only -o $S/A.out "review A" < /dev/null > $S/A.log 2>&1 &\nnohup codex exec -o ${S}/B.out "review B" >/dev/null 2>&1 &\nnohup ./run.sh C &\nsleep 2`)
  expect(jobs.map(j => [j.provider, j.watch, j.log])).toEqual([
    ['codex', `${S}/A.out`, `${S}/A.log`],
    ['codex', `${S}/B.out`, undefined],
  ])
  // a foreground run is not detached, and no path to watch means no detached box
  expect(detachedJobs('codex exec "x" > /s/a.log')).toEqual([])
  expect(detachedJobs('codex exec "x" &')).toEqual([])
  expect(providerOf('sleep 2; pgrep -fl "codex exec"')).toBe(undefined)
})

test('CLI boxes are named by their -o file, else the Bash description', () => {
  expect(jobLabel('codex exec -o /s/r2/explain-the-number.out "x"')).toBe('explain-the-number')
  expect(jobLabel('codex exec --output-last-message=/s/B.md "x"', 'ignored')).toBe('B')
  expect(jobLabel('codex exec -o $S/A.out "x"', 'desc')).toBe('A')
  expect(jobLabel('codex exec -o "$OUT" "x"', 'Codex reviewer A: quality')).toBe('Codex reviewer A: quali…')
  expect(jobLabel('codex exec "x"', '  ')).toBe(undefined)
  expect(jobLabel('codex exec "x"')).toBe(undefined)
})

test('a labelled foreground run_in_background launch gets its label as name', async () => {
  const values = new Map<string, unknown>()
  const handlers = new Map<string, Function>()
  const engine = fakeEngine({}, { values })
  register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
  await handlers.get('session.start')!(engine, {}, async () => ({}))
  await handlers.get('command.run')!(engine, { command: 'team-graph' }, async () => ({}))
  for (const [i, name] of ['A', 'A'].entries())
    await handlers.get('tool.call')!(engine, { tool: 'Bash', input: { command: `codex exec -o /s/${name}.out "go" < /dev/null`, run_in_background: true, description: 'x' } }, async () => ({ text: `Output file: /t/${i}.output` }))
  const nodes = values.get(JSON.stringify({ plugin: 'team-graph', key: 'nodes' })) as any[]
  expect(nodes.map(n => n.name)).toEqual(['codex:A', 'codex:A-2'])
})

test('detached Codex jobs stay running after the Bash call and finish when their process exits', async () => {
  const handlers = new Map<string, Function>()
  const values = new Map<string, unknown>()
  const timers = new Map<number, Function>()
  const files = new Map<string, string>()
  const alive = new Set<string>()
  const dir = '/private/tmp/claude-501/project/detached-session/tasks'
  const engine = fakeEngine({
    clock: { now: async () => 100000 },
    session: { id: async () => 'detached-session' },
    fs: {
      list: async (path: string) => path === '/private/tmp/claude-501' ? [{ name: 'project', kind: 'dir' }] : path === '/private/tmp/claude-501/project' ? [{ name: 'detached-session', kind: 'dir' }] : path === dir ? [] : [],
      read: async () => { throw new Error('No team') },
    },
    process: { run: async (argv: string[]) => {
      if (argv[0] === 'id') return { stdout: '501' }
      if (argv[0] === 'pgrep') return { stdout: '', exitCode: alive.has(argv[2]) ? 0 : 1 }
      if (argv[0] === 'tail') return files.has(argv.at(-1)!) ? { stdout: files.get(argv.at(-1)!)!, exitCode: 0 } : { stdout: '', exitCode: 1 }
      throw new Error('Unexpected command')
    } },
  }, { values, timers })
  register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
  const run = (name: string, event: unknown, next: Function = async () => ({})) => handlers.get(name)!(engine, event, next)
  const state = (key: string) => values.get(JSON.stringify({ plugin: 'team-graph', key })) as any
  const tick = () => timers.get(1000)!()
  await run('session.start', {})
  await run('command.run', { command: 'team-graph' })

  alive.add('/s/A.out').add('/s/B.out')
  const command = 'nohup codex exec -o /s/A.out "A" > /s/A.log 2>&1 &\nnohup codex exec -o /s/B.out "B" > /dev/null 2>&1 &'
  await run('tool.call', { tool: 'Bash', command }, async () => ({ stdout: '', exit_code: 0 }))
  expect(state('nodes').map((n: any) => [n.name, n.done])).toEqual([['codex:A', false], ['codex:B', false]])

  files.set('/s/A.log', 'codex\nlooking at diff\n')
  await tick()
  expect(state('nodes').every((n: any) => !n.done)).toBe(true)

  alive.delete('/s/A.out')
  files.set('/s/A.out', 'REVIEWER: A\nVERDICT: ship')
  alive.delete('/s/B.out')
  await tick()
  const [a, b] = state('nodes')
  expect([a.status, a.done, a.answer]).toEqual(['completed', true, 'REVIEWER: A VERDICT: ship'])
  expect([b.status, b.done]).toEqual(['failed', true])
})
