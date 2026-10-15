/**
 * Delegation-activity guidance: inject a prompt section right after the native
 * `tool:subagent` section, evaluated live at each assembly from the volatile
 * `subagentActivity` config field. `balanced` contributes nothing (native
 * behaviour). The section stays empty when no delegation tool is visible in
 * the assembling scope — same visibility probe the native section uses.
 */

import type { Context } from '@deepseek-ai/cordis'
import { unwrapVolatile } from './config.ts'
import type { Config, DelegationActivity } from './shared.ts'

const ACTIVITY_GUIDANCE: Record<DelegationActivity, string> = {
  conservative:
    'Delegation policy: conservative. Prefer completing work inline. Delegate to subagents only '
    + 'when a subtask is clearly independent, self-contained, and large enough to justify the '
    + 'delegation overhead; everything else stays in this conversation.',
  balanced: '',
  aggressive:
    'Delegation policy: aggressive. Prefer splitting multi-part work into independent subagent '
    + 'tasks and starting them together in one assistant message; keep only integration and final '
    + 'synthesis inline. When a subtask is plausibly separable, delegate it rather than doing it '
    + 'yourself.',
}

interface SystemPromptFace {
  section(section: {
    name: string
    order: number
    text: string | ((context: { scope?: unknown }) => string)
  }): unknown
  getSectionOrder(name: 'TOOL_SUBAGENT'): number
}
interface ToolsFace {
  get(name: string, scope?: unknown): unknown
}

export function installDelegationActivity(ctx: Context, current: () => Config): void {
  // Equal order: 'tool:subagent' sorts before 'tool:subagent-activity' (strict
  // prefix), so this section lands immediately after the native guidance.
  ctx.inject(['systemPrompt', 'tools'], (scope) => {
    const { systemPrompt, tools } = scope as unknown as { systemPrompt: SystemPromptFace; tools: ToolsFace }
    systemPrompt.section({
      name: 'tool:subagent-activity',
      order: systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
      text: (context) => {
        const activity = unwrapVolatile(current().subagentActivity) ?? 'balanced'
        // Unknown values (a malformed composition entry) fall back to balanced
        // instead of rendering an undefined section.
        const guidance = ACTIVITY_GUIDANCE[activity] ?? ''
        if (guidance === '') return ''
        const visible = tools.get('subagent', context.scope) !== undefined
          || tools.get('subagent_fork', context.scope) !== undefined
        return visible ? guidance : ''
      },
    })
  })
}
