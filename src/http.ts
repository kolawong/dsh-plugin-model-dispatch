/** Shared host-side HTTP helpers for the plugin's loopback routes. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** Minimal face of the host web-server route registry. */
export interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Write one JSON response with no-store caching. */
export function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(bytes.length),
  })
  res.end(bytes)
}

/** Read a request body, rejecting oversized payloads. */
export function readBody(req: IncomingMessage, limit = 65_536): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk
      if (data.length > limit) {
        rejectBody(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => { resolveBody(data) })
    req.on('error', rejectBody)
  })
}

/**
 * Mount a route exactly once, whether the web server is already up or arrives
 * later. `ctx.effect` ties the registration to the plugin's lifetime.
 */
export function mountRoute(
  ctx: Context,
  path: string,
  label: string,
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): void {
  // Always go through ctx.inject: the registration effect belongs to the
  // injected fiber, so a webServer service replacement disposes the old fiber
  // (unregistering the route) and re-runs the callback on the new server.
  ctx.inject(['webServer'], (scope) => {
    const web = (scope as unknown as { webServer: WebRouteHost }).webServer
    scope.effect(() => web.register({ kind: 'exact', path, handler }), label)
  })
}
