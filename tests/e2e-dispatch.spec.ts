/**
 * End-to-end rehearsal: one mock host runs both dispatch chains together.
 *
 * Chain A (subagent routing): settings default → session override → explicit
 * delegation selection → route validation rejection, all before child creation.
 * Chain B (plan-mode auto switch): /plan entry persists the main selection and
 * drafts with the planning model; approval restores the exact pre-plan route
 * before the first execution request.
 *
 * The scenario interleaves both chains in one session to prove independence:
 * plan switching never touches subagent routing, and delegations during plan
 * drafting still follow the session override.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { installSubagentRouting } from '../src/subagent-routing.ts'
import { installPlanModelSwitch, type PlanMainStore } from '../src/plan-model.ts'
import { PLAN_BOUNDARY_KEY, planBoundaryDefinition } from '../src/plan-boundary.ts'
import { modelRouteValidator } from '../src/model-route.ts'
import { delegationSelection } from '../src/delegation-selection.ts'
import type { Config, ModelSelectionConfig } from '../src/shared.ts'

// Cast of models (mirrors the live-verification docs' provider shapes).
const main = { provider: 'droid', model: 'claude-sonnet-5-5', reasoningEffort: 'high' }
const planning = { provider: 'step', model: 'step-5-preview' }
const subDefault = { provider: 'opencode-go-completions', model: 'deepseek-v4.1-flash' }
const override = { provider: 'factory-g', model: 'glm-5.3-flash' }
const explicit = { provider: 'opencode-go', model: 'glm-5.3-flash' }
const invalid = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } // wrong provider for this model

function setupHost() {
  const config: Config = {
    subagent: { mode: 'custom', selection: { ...subDefault } },
    planPlanning: { mode: 'custom', selection: { ...planning } },
  }
  // Route validation through the host's owning adapter (resolveCallConfig).
  const catalog = new Set([
    'droid/claude-sonnet-5-5',
    'step/step-5-preview',
    'opencode-go-completions/deepseek-v4.1-flash',
    'factory-g/glm-5.3-flash',
    'opencode-go/glm-5.3-flash',
  ])
  const resolveCallConfig = vi.fn(async (route: ModelSelectionConfig) => {
    if (!catalog.has(`${route.provider}/${route.model}`)) {
      throw new Error(`pi-ai provider "${route.provider}" has no configured model "${route.model}"`)
    }
    if (route.reasoningEffort !== undefined && route.reasoningEffort !== 'high') throw new Error('unsupported reasoning effort')
    return { ...route, maxTokens: 1000 }
  })
  const validate = modelRouteValidator({ get: () => ({ resolveCallConfig }) } as never)

  // Durable per-session subagent overrides ($DSH_HOME/storages/... in production).
  const overrides = new Map<string, ModelSelectionConfig>()
  const children: Array<Record<string, unknown> | undefined> = []
  const innerStart = vi.fn(async (_name: string, request: { agentOptions?: Record<string, unknown> }) => {
    children.push(request.agentOptions)
    return { status: 'completed', result: 'CHILD_OK' }
  })
  const innerContinuable = vi.fn(async (spec: { request: { agentOptions?: Record<string, unknown> } }) => {
    children.push(spec.request.agentOptions)
    return { status: 'completed', result: 'CHILD_OK' }
  })
  // Newer hosts delegate exclusively through startActivation — include it too.
  const innerActivation = vi.fn(async (spec: { request: { agentOptions?: Record<string, unknown> } }) => {
    children.push(spec.request.agentOptions)
    return { childId: 'child-activation' }
  })
  const runtime = { start: innerStart, startContinuable: innerContinuable, startActivation: innerActivation }
  installSubagentRouting(
    { subagents: runtime, logger: { warn() {} }, effect(install: () => () => void) { install() } } as never,
    () => config,
    { get: (id: string) => overrides.get(id) } as never,
    validate,
  )

  // Plan-mode machinery (same shape as tests/plan-model.spec.ts).
  const events = new Context()
  const session = { header: { id: 's1', origin: undefined as string | undefined } }
  const agent = { id: 's1', session, options: { ...main } }
  const plan = { active: false, wanted: null as boolean | null, pending: undefined as boolean | undefined }
  const projected = { lastUsed: main as ModelSelectionConfig | null, pending: null as ModelSelectionConfig | null }
  const selected = { current: main as ModelSelectionConfig, assembled: undefined as ModelSelectionConfig | undefined }
  const persisted = new Map<string, ModelSelectionConfig>()
  const mains: PlanMainStore = {
    get: id => persisted.get(id),
    async set(id, value) { if (value) persisted.set(id, { ...value }); else persisted.delete(id) },
  }
  let boundary = planBoundaryDefinition.init()
  const switches: ModelSelectionConfig[] = []
  installModelSelection(events, selected as never)
  installPlanModelSwitch({
    inject(_deps: string[], apply: (ctx: unknown) => void) {
      apply({
        on: events.on.bind(events),
        get: () => ({ get: () => plan }),
        sessionProjections: {
          register() {},
          stateOf(_session: unknown, key: string) { return key === 'plan' ? plan : key === PLAN_BOUNDARY_KEY ? boundary : projected },
        },
        sessionController: { async selectModel(request: ModelSelectionConfig) {
          switches.push(request); projected.pending = request; selected.current = request
        } },
      })
    },
  } as never, () => config, mains)

  return {
    config, resolveCallConfig, overrides, runtime, children, agent, session, plan, projected, mains, switches,
    // installSubagentRouting WRAPS runtime.start; keep the inner mocks for call counting.
    innerStart,
    approve() {
      boundary = planBoundaryDefinition.apply(boundary, { type: 'tool/call', data: { name: 'exit_plan_mode', callId: 'exit1' } })
      boundary = planBoundaryDefinition.apply(boundary, { type: 'tool/result', data: { message: { source: { callId: 'exit1' }, content: [{ type: 'text', text: 'Plan approved — plan mode exited; carry out the plan starting with your next step.' }] } } })
      plan.pending = false
    },
    async request() {
      await events.waterfall('system-prompt/assemble', { variables: {} }, { agent }, async () => ({ variables: {} }))
      return events.waterfall('agent/request', {}, async () => main)
    },
    consume() { projected.lastUsed = selected.current; projected.pending = null },
  }
}

describe('end-to-end rehearsal: subagent routing + plan-mode auto switch in one session', () => {
  it('walks the full lifecycle and keeps both chains independent', async () => {
    const h = setupHost()

    // ── Act 1: ordinary turn, delegation follows the SETTINGS DEFAULT ──
    expect(await h.request()).toEqual(main)
    await h.runtime.start('standard', { parent: h.agent })
    expect(h.children.at(-1)).toEqual(subDefault)
    expect(h.resolveCallConfig).toHaveBeenLastCalledWith(subDefault)

    // ── Act 2: chat-bar pick stores a SESSION OVERRIDE; it beats the default ──
    h.overrides.set('s1', override)
    await h.runtime.startContinuable({ request: { parent: h.agent }, label: 'research' })
    expect(h.children.at(-1)).toEqual(override)

    // ── Act 3: an EXPLICIT delegation selection beats the override ──
    // (list_subagent_models / explicit start options travel via AsyncLocalStorage)
    await delegationSelection.run({ parent: h.agent, ...explicit }, () =>
      h.runtime.start('standard', { parent: h.agent }))
    // Effort belongs to a route: a bare explicit route drops the override's effort.
    expect(h.children.at(-1)).toEqual(explicit)
    expect(h.resolveCallConfig).toHaveBeenLastCalledWith(explicit)

    // ── Act 4: an INVALID override is rejected BEFORE any child is created ──
    h.overrides.set('s1', invalid)
    const before = h.innerStart.mock.calls.length
    await expect(h.runtime.start('standard', { parent: h.agent })).rejects.toThrow('Invalid model route opencode-go/deepseek-v4.1-flash')
    expect(h.innerStart.mock.calls.length).toBe(before)
    h.overrides.set('s1', override) // user fixes the pick

    // ── Act 5: /plan — entry persists the main route and drafts with PLANNING ──
    h.plan.pending = true
    expect((await h.request()).model).toBe(planning.model)
    expect(h.mains.get('s1')).toEqual(main) // exact pre-plan provider/model/effort
    expect(h.switches).toMatchObject([planning])
    expect(h.switches[0]).toMatchObject({ sessionId: 's1' })

    // ── Act 6: delegation DURING drafting still follows the override ──
    // (via startActivation — the only delegation path on newer hosts)
    await h.runtime.startActivation({ provider: 'standard', request: { parent: h.agent }, delivery: 'parent' })
    expect(h.children.at(-1)).toEqual(override)
    expect(h.switches).toMatchObject([planning]) // subagent routing never touches the main session model

    // ── Act 7: approval restores MAIN before the first execution request ──
    h.consume(); h.plan.active = true; h.approve()
    expect(await h.request()).toMatchObject(main)
    expect(h.switches).toMatchObject([planning, main]) // restored with the original effort
    expect(h.mains.get('s1')).toBeUndefined() // persisted record cleared after success
    h.consume()
    expect(await h.request()).toMatchObject(main) // steady state: no more switching

    // ── Epilogue: settings defaults and the session override survive untouched ──
    expect(h.config.subagent).toEqual({ mode: 'custom', selection: subDefault })
    expect(h.config.planPlanning).toEqual({ mode: 'custom', selection: planning })
    expect(h.overrides.get('s1')).toEqual(override)
  })

  it('restores main on direct /plan off and never involves subagent sessions', async () => {
    const h = setupHost()
    h.plan.pending = true
    expect((await h.request()).model).toBe(planning.model)
    h.consume(); h.plan.active = true; h.plan.pending = false // user types /plan off
    expect(await h.request()).toMatchObject(main)
    expect(h.mains.get('s1')).toBeUndefined()

    // Subagent-origin sessions participate in neither chain's plan switching.
    h.session.header.origin = 'subagent'
    h.plan.pending = true
    expect(await h.request()).toMatchObject(main)
    expect(h.mains.get('s1')).toBeUndefined()
    expect(h.switches.filter(s => s.model === planning.model)).toHaveLength(1)
  })
})
