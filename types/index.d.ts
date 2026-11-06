export type Node = { id: string; name: string; status: string; tools: number; last: string; done: boolean; since?: number; ended?: number; base?: number; external?: string; output?: string; background?: boolean; changed?: number; answer?: string; waiting?: boolean; tokens?: number; reason?: string }
export type Msg = { at: number; from: string; to: string; text: string }
export type Flight = { from: string; to: string; at: number }
export type Features = { needs: boolean; tokens: boolean; reasons: boolean; limits: boolean }
export type Usage = { usd: number; limit: number; kind: string }
export type Wait = { agent: string; call: string }

declare module 'claude-code' {
  interface PluginState {
    'team-graph': { nodes: Node[]; log: Msg[]; flights: Flight[]; frame: number; messageCount: number; times: number[]; shown: boolean; owner: { id: string; beat: number }; theme: string; robotStyle: string; graphRows: number; motion: boolean; openedAt: number; mainLast: string; mainAt: number; features: Features; usage: Usage; waits: Wait[]; modes: Record<string, string> }
  }
}
