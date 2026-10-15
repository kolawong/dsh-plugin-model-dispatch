/** Four settings rows, with only the scope needed to choose a model. */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveCustomSelection, type DelegationActivity, type RouteSwitchConfig } from '../shared.ts'
import { ConfigStore, MainModelStore } from './config-store.ts'
import { ModelPicker, type ModelCatalogAccess } from './ModelPicker.tsx'
import type { LocaleKey } from './locales.ts'
import css from './styles.module.css'

export interface SettingsInjected {
  store: ConfigStore
  mainStore: MainModelStore
  access: ModelCatalogAccess
  t: (key: LocaleKey) => string
}
export type SettingsSectionProps = PropsRuntime<'settings.section'> & Partial<SettingsInjected>

function SettingRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const id = useId()
  return <section className={css.settingRow} aria-labelledby={id}>
    <div className={css.settingCopy}>
      <h3 id={id} className={css.settingTitle}>{title}</h3>
      <p className={css.settingHint}>{hint}</p>
    </div>
    <div className={css.settingControl}>{children}</div>
  </section>
}

function RouteRow({ title, hint, route, save, access, t, busy }: {
  title: string; hint: string; route: RouteSwitchConfig; save: (next: RouteSwitchConfig) => Promise<void>
  access: ModelCatalogAccess; t: (key: LocaleKey) => string; busy: boolean
}) {
  const selection = resolveCustomSelection(route)
  return <SettingRow title={title} hint={hint}>
    <ModelPicker
      stretch sessionId={undefined} access={access} value={selection} disabled={busy} t={t}
      controlLabel={title}
      fallbackLabel={route.mode === 'custom' ? t('triggerFallback') : t('modeFollow')}
      onChange={selection => save({ mode: 'custom', selection })}
      onClear={route.mode === 'custom' ? () => save({ mode: 'follow-main', selection: route.selection }) : undefined}
      clearLabel={t('modeFollow')}
    />
  </SettingRow>
}

const ACTIVITIES: readonly DelegationActivity[] = ['conservative', 'balanced', 'aggressive']
const ACTIVITY_LABEL_KEY: Record<DelegationActivity, LocaleKey> = {
  conservative: 'activityConservative',
  balanced: 'activityBalanced',
  aggressive: 'activityAggressive',
}
const ACTIVITY_HINT_KEY: Record<DelegationActivity, LocaleKey> = {
  conservative: 'activityHintConservative',
  balanced: 'activityHintBalanced',
  aggressive: 'activityHintAggressive',
}

/**
 * Delegation-activity slider: optimistic draft, 200ms-debounced commit, flush
 * on unmount (no lost write), rollback to the last accepted value on failure.
 */
function ActivityRow({ value, busy, save, t }: {
  value: DelegationActivity
  busy: boolean
  save: (next: DelegationActivity) => Promise<void>
  t: (key: LocaleKey) => string
}) {
  const [draft, setDraft] = useState<DelegationActivity | undefined>()
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingRef = useRef<DelegationActivity | undefined>(undefined)
  const saveRef = useRef(save); saveRef.current = save
  const shown = draft ?? value

  // A committed write (or an external change) clears the optimistic draft.
  useEffect(() => { setDraft(undefined) }, [value])

  // Flush a pending drag instead of dropping it on unmount.
  useEffect(() => () => {
    if (debounce.current !== undefined) clearTimeout(debounce.current)
    const pending = pendingRef.current
    if (pending !== undefined) void saveRef.current(pending).catch(() => {})
  }, [])

  const commit = (next: DelegationActivity): void => {
    setDraft(next)
    pendingRef.current = next
    if (debounce.current !== undefined) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      debounce.current = undefined
      pendingRef.current = undefined
      // 失败回滚：store 未变 → 清掉 draft 即回到已保存值。
      void save(next).catch(() => { setDraft(undefined) })
    }, 200)
  }

  const index = ACTIVITIES.indexOf(shown)
  const stops = Math.max(1, ACTIVITIES.length - 1)
  return <SettingRow title={t('activityTitle')} hint={`${t(ACTIVITY_HINT_KEY[shown])} ${t('activityHint')}`}>
    <div className={css.activityControl}>
      <div className={css.activityHead}>
        <span className={css.activityValue}>{t(ACTIVITY_LABEL_KEY[shown])}</span>
      </div>
      <div className={css.activitySlider}>
        <div className={css.activityRail} aria-hidden>
          <span className={css.activityFill} style={{ width: `${(index / stops) * 100}%` }} />
          {ACTIVITIES.map((level, stop) => <span key={level} className={css.activityTick} style={{ left: `${(stop / stops) * 100}%` }} />)}
        </div>
        <input
          type="range"
          className={css.activityRange}
          min={0}
          max={stops}
          step={1}
          value={index}
          disabled={busy}
          aria-label={t('activityTitle')}
          aria-valuetext={t(ACTIVITY_LABEL_KEY[shown])}
          onChange={event => {
            const next = ACTIVITIES[Number(event.target.value)]
            if (next !== undefined && next !== shown) commit(next)
          }}
        />
      </div>
      <div className={css.activityStops}>
        {ACTIVITIES.map(level => <span key={level}>{t(ACTIVITY_LABEL_KEY[level])}</span>)}
      </div>
    </div>
  </SettingRow>
}

export function SettingsSection(props: SettingsSectionProps) {
  if (!props.store || !props.mainStore || !props.access || !props.t) return null
  return <SettingsSectionLoaded store={props.store} mainStore={props.mainStore} access={props.access} t={props.t} />
}

function SettingsSectionLoaded({ store, mainStore, access, t }: SettingsInjected) {
  const snap = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
  const main = useSyncExternalStore(listener => mainStore.subscribe(listener), () => mainStore.getSnapshot())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = async (write: () => Promise<void>): Promise<void> => {
    setSaving(true); setMessage(null); setError(null)
    try { await write(); setMessage(t('saved')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause }
    finally { setSaving(false) }
  }
  const saveRoute = (field: 'subagent' | 'planPlanning') => (next: RouteSwitchConfig): Promise<void> => save(() => store.saveRoute(field, next))
  const busy = saving || snap.status !== 'ready'
  return <div className={css.section} data-model-switch-settings="">
    <header className={css.settingsHeader}>
      <h2 className={css.title}>{t('title')}</h2>
      <span className={css.saveStatus} role="status">{saving ? t('statusSaving') : message}</span>
    </header>
    {(error || snap.error) && <p className={css.error} role="alert">{t('saveError')}: {error ?? t('unavailable')}</p>}
    <div className={css.settingsList}>
      <SettingRow title={t('mainTitle')} hint={t('mainHint')}>
        {main.status === 'error' ? <p className={css.error}>{t('mainUnavailable')}</p> : <ModelPicker
          stretch sessionId={undefined} access={access} value={main.value}
          disabled={saving || main.status !== 'ready'} t={t} controlLabel={t('mainTitle')}
          fallbackLabel={main.status === 'loading' ? t('statusLoading') : undefined}
          onChange={next => save(() => mainStore.save(next))}
        />}
      </SettingRow>
      <RouteRow title={t('subagentTitle')} hint={t('subagentHint')} route={snap.value.subagent ?? { mode: 'follow-main' }} save={saveRoute('subagent')} access={access} t={t} busy={busy} />
      <RouteRow title={t('planPlanningTitle')} hint={t('planPlanningHint')} route={snap.value.planPlanning ?? { mode: 'follow-main' }} save={saveRoute('planPlanning')} access={access} t={t} busy={busy} />
      <ActivityRow value={snap.value.subagentActivity ?? 'balanced'} busy={busy} save={next => save(() => store.saveActivity(next))} t={t} />
    </div>
  </div>
}
