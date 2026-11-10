import { register, resetModuleState } from './register'

export const stateKey = (key: string) => JSON.stringify({ plugin: 'team-graph', key })

export function fakeEngine(overrides: any = {}, storage: { values?: Map<string, unknown>; timers?: Map<number, Function> } = {}) {
  resetModuleState()
  const values = storage.values ?? new Map<string, unknown>()
  // existing tests start from a hidden pane; the open-by-default test clears this
  if (!values.has(stateKey('shown'))) values.set(stateKey('shown'), false)
  const timers = storage.timers ?? new Map<number, Function>()
  const defaults = {
    state: {
      get: async (key: unknown) => ({ value: values.get(JSON.stringify(key)) }),
      set: async (key: unknown, value: unknown) => { values.set(JSON.stringify(key), value); return { isSet: true } },
    },
    clock: { now: async () => 10000, every: (ms: number, callback: Function) => timers.set(ms, callback), sleep: async () => {} },
    agent: { list: async () => [] },
    session: { id: async () => 'test-session' },
    env: { get: async (name: string) => name === 'HOME' ? '/home/test' : undefined },
    fs: { list: async () => [], read: async () => { throw new Error('Missing file') }, stat: async () => { throw new Error('Missing metadata') }, write: async () => {} },
    process: { run: async () => ({ stdout: '', exitCode: 1 }) },
    command: { register: async () => {} },
    store: { get: async () => undefined, set: async () => {} },
    ui: { status: () => {}, open: async () => {}, close: async () => {}, toast: () => {}, resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button' }) },
  }
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { ...value, ...overrides[key] }])) as any
}

export function harness(overrides: any = {}) {
  const values = new Map<string, unknown>(), timers = new Map<number, Function>(), handlers = new Map<string, Function>()
  const engine = fakeEngine(overrides, { values, timers })
  register(((name: string, ...args: unknown[]) => handlers.set(name, args.at(-1) as Function)) as Parameters<typeof register>[0])
  return {
    engine, values, timers,
    state: (key: string) => values.get(stateKey(key)) as any,
    set: (key: string, value: unknown) => values.set(stateKey(key), value),
    run: (name: string, event: unknown = {}, next: Function = async () => ({})) => handlers.get(name)!(engine, event, next),
    tick: () => timers.get(1000)!(),
  }
}
