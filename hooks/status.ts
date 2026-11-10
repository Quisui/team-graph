import type { Node } from '../types'

// A box's lifecycle as every renderer reads it.
export const isPending = (n: Node) => n.status === 'pending' || n.status === 'idle' && (!n.done || n.since == null && !n.tools && !n.last)
export const isDone = (n: Node) => !isPending(n) && (n.done || ['completed', 'failed', 'killed', 'idle'].includes(n.status))
export const isFailed = (n: Node) => n.status === 'failed' || n.status === 'killed'
// names the orchestrator goes by in team files and messages
export const LEAD = ['team-lead', 'orchestrator', 'main', 'lead']

export type Kind = 'failed' | 'waiting' | 'pending' | 'done' | 'running' | 'idle'
// one state per box, in the order the boxes are coloured: a failure wins over a waiting dialog, and so on
export const kindOf = (n: Node): Kind =>
  isFailed(n) ? 'failed' : n.waiting && !isDone(n) ? 'waiting' : isPending(n) ? 'pending' : isDone(n) ? 'done' : n.status === 'running' ? 'running' : 'idle'
