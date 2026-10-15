/**
 * Host registry of subagent session → display label + HTTP readout.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { formatModelLabel, SESSION_LABELS_ROUTE, type ModelLabelParts } from './label.ts'
import { json, mountRoute } from './http.ts'
import type { ModelSelectionConfig } from './shared.ts'

export { SESSION_LABELS_ROUTE }

/** In-memory labels keyed by child session id. */
export class SessionLabelRegistry {
  private readonly labels = new Map<string, string>()

  get(sessionId: string): string | undefined {
    return this.labels.get(sessionId)
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.labels)
  }

  set(sessionId: string, label: string): void {
    if (label.length === 0) {
      this.labels.delete(sessionId)
      return
    }
    this.labels.set(sessionId, label)
  }
}

/**
 * Resolve a human label from agent route + optional effort override.
 * @param ctx - host context with optional llm service.
 * @param agent - newly created / live agent.
 * @param effortId - reasoning effort id when known.
 */
export async function resolveAgentLabel(
  ctx: Context,
  agent: Agent,
  effortId: string | undefined,
): Promise<string | undefined> {
  const provider = agent.options.provider
  const model = agent.options.model
  if (provider === undefined || model === undefined) return undefined

  const parts: ModelLabelParts = { modelName: model }
  const llm = ctx.get('llm') as {
    resolveModelInfo?: (provider: string, model: string) => Promise<{
      name?: string
      context?: { contextWindow: number }
      reasoning?: {
        efforts: readonly { id: string; name: string }[]
        defaultEffort?: string
      }
    }>
  } | undefined

  if (llm?.resolveModelInfo !== undefined) {
    try {
      const info = await llm.resolveModelInfo(provider, model)
      if (info.name !== undefined && info.name.length > 0) parts.modelName = info.name
      if (info.context?.contextWindow !== undefined) {
        parts.contextWindow = info.context.contextWindow
      }
      const effort = effortId ?? info.reasoning?.defaultEffort
      if (effort !== undefined && info.reasoning !== undefined) {
        parts.effortName = info.reasoning.efforts.find(row => row.id === effort)?.name ?? effort
      } else if (effort !== undefined) {
        parts.effortName = effort
      }
    } catch {
      if (effortId !== undefined) parts.effortName = effortId
    }
  } else if (effortId !== undefined) {
    parts.effortName = effortId
  }

  return formatModelLabel(parts)
}

/**
 * Remember labels for every subagent agent that appears; update effort on request.
 * @param ctx - host context.
 * @param registry - label map.
 * @param currentEffort - live custom-selection effort reader.
 */
export function installSessionLabelTracking(
  ctx: Context,
  registry: SessionLabelRegistry,
  currentEffort: () => string | undefined,
): void {
  // Labels only change when the route does: remember the last computed
  // provider/model/effort per session and skip the catalog lookup otherwise.
  const signatures = new Map<string, string>()
  const track = (sessionId: string, agent: Agent, effort: string | undefined): void => {
    const signature = `${agent.options.provider ?? ''}/${agent.options.model ?? ''}/${effort ?? ''}`
    if (signatures.get(sessionId) === signature) return
    signatures.set(sessionId, signature)
    void resolveAgentLabel(ctx, agent, effort).then((label) => {
      if (label !== undefined) registry.set(sessionId, label)
    })
  }
  ctx.on('agent/created', ({ agent }): undefined => {
    if (agent.session.header.origin !== 'subagent') return
    const sessionId = String(agent.session.header.id)
    track(sessionId, agent, currentEffort())

    agent.ctx.on('agent/request', async (_payload, next) => {
      const seed = await next()
      const effortRaw = seed.reasoningEffort ?? currentEffort()
      const effort = effortRaw === undefined ? undefined : String(effortRaw)
      track(sessionId, {
        ...agent,
        options: {
          ...agent.options,
          provider: seed.provider ?? agent.options.provider,
          model: seed.model ?? agent.options.model,
        },
      } as Agent, effort)
      return seed
    })
  })
}

/**
 * Mount GET session-labels when a web server is available.
 * @param ctx - host context.
 * @param registry - label map.
 */
export function installSessionLabelsHttp(ctx: Context, registry: SessionLabelRegistry): void {
  mountRoute(ctx, SESSION_LABELS_ROUTE, 'model-switch: session-labels route', (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' })
      res.end()
      return
    }
    json(res, 200, { ok: true, value: registry.snapshot() })
  })
}

/** Helper for tests / callers that already have a selection. */
export function effortFromSelection(
  selection: ModelSelectionConfig | undefined,
): string | undefined {
  const effort = selection?.reasoningEffort
  return effort !== undefined && effort.length > 0 ? effort : undefined
}
