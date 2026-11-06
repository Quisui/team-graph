import { expect, test } from 'claude-code/testing'
import { drawGraph, drawBus, retro } from './register'
import snapshots from './render.snapshots'

const agents = [
  { id: 'a@s', name: 'a', status: 'completed', tools: 1, last: 'Read(file)', done: true, since: 0, ended: 1000 },
  { id: 'b@s', name: 'b', status: 'running', tools: 3, last: 'Bash(test)', done: false, since: 0 },
]
// Fix the local clock display so these snapshots do not depend on the test runner's timezone.
const messageAt = new Date(2000, 0, 1, 18, 0, 1).getTime()
const messages = [{ at: messageAt, from: 'a', to: 'main', text: 'done' }, { at: messageAt + 200, from: 'main', to: 'b', text: 'check results' }]
const output = () => {
  const cases: Record<string, unknown> = {}
  for (const look of ['classic', 'retro']) for (const style of ['head', 'plain'])
    for (const width of [25, 80, 140]) for (const enabled of [false, true])
      for (const now of [1000, 1150, 1300, 1450, 5000]) {
        const key = [look, style, width, enabled, now].join('/')
        const graph = drawGraph(agents, width, [{ from: 'a', to: 'b', at: 0 }], now, Math.floor(now / 150), false, look, 20, { enabled }, style)
        const bus = drawBus(agents, messages, width, now, 2, [1000, 1200])
        const rows = [...graph, ...bus]
        cases[key] = look === 'retro' ? retro(rows) : rows
      }
  return cases
}

test('graph and bus snapshots preserve text, colours and styles', () => {
  expect(JSON.parse(JSON.stringify(output()))).toEqual(snapshots)
})
