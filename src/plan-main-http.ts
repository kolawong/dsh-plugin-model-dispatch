/** Read-only pre-plan selections for the review panel. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionOverrideStore } from './session-overrides.ts'
import { PLAN_MAIN_MODELS_ROUTE } from './plan-routes.ts'
import { json, mountRoute } from './http.ts'

export function installPlanMainsHttp(ctx: Context, store: SessionOverrideStore): void {
  mountRoute(ctx, PLAN_MAIN_MODELS_ROUTE, 'model-switch: pre-plan models', (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' })
      res.end()
      return
    }
    json(res, 200, { ok: true, value: store.snapshot() })
  })
}
