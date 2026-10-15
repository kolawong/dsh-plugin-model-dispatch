/** One searchable, keyboard-accessible model menu shared by every surface. */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ModelCatalog, ModelSelection, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCloseFillRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelSelectionConfig } from '../shared.ts'
import { modelKey, modelPreferences } from './model-preferences.ts'
import type { LocaleKey } from './locales.ts'
import { IconStar } from './IconStar.tsx'
import css from './ModelPicker.module.css'

export interface ModelCatalogAccess {
  loadCatalog: () => Promise<ModelCatalog>
  currentSelection: (sessionId: SessionId) => ModelSelection | undefined
}
export interface ModelPickerProps {
  sessionId: SessionId | undefined
  access: ModelCatalogAccess
  value: ModelSelectionConfig | undefined
  onChange: (next: ModelSelectionConfig) => void | Promise<void>
  t: (key: LocaleKey) => string
  disabled?: boolean
  className?: string
  compact?: boolean
  placement?: 'top' | 'bottom'
  fallbackLabel?: string
  requireSession?: boolean
  /** Accessible control/menu label without another visible trigger prefix. */
  controlLabel?: string
  /** Full-width setting control; chat chips keep their compact layout. */
  stretch?: boolean
  roleLabel?: string
  /** Glyph that replaces the role words in a compact chip; `roleLabel` still
   *  names the control for assistive tech and the menu header. */
  roleIcon?: ReactNode
  /** Compact chip text that replaces the model name; the full route stays in
   *  the tooltip and accessible label. Used for routes that only inherit. */
  compactLabel?: string
  scopeHint?: string
  sourceLabel?: string
  onClear?: () => void | Promise<void>
  clearLabel?: string
}
export function ModelPicker({ sessionId, access, value, onChange, t, disabled, className, placement = 'bottom', fallbackLabel, requireSession = false, roleLabel, controlLabel, stretch = false, scopeHint, sourceLabel, onClear, clearLabel, compact = false, compactLabel, roleIcon }: ModelPickerProps) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<ModelSelectionConfig | undefined>()
  const [position, setPosition] = useState({ left: 0, top: 0, height: 480 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const loadRevision = useRef(0)
  const preferences = useSyncExternalStore(modelPreferences.subscribe, modelPreferences.getSnapshot)
  const id = useId()
  // Live apply: every choice writes through on the spot, so the menu carries no
  // confirm row. Writes are chained (one host call at a time) and the effort
  // slider coalesces a drag before it commits.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())
  const inFlightRef = useRef(0)
  const effortTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const valueRef = useRef(value); valueRef.current = value
  const load = (): void => {
    const revision = ++loadRevision.current
    setLoading(true); setError(null)
    void access.loadCatalog().then(next => {
      if (revision === loadRevision.current) { setCatalog(next); setLoading(false) }
    }).catch((cause: unknown) => {
      if (revision === loadRevision.current) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false) }
    })
  }
  useEffect(() => { load(); return () => { loadRevision.current += 1 } }, [access])
  const choices = useMemo(() => catalog?.groups.flatMap(group => group.models.map(model => ({
    ...model, provider: group.id, providerName: group.name, model: model.id,
  }))) ?? [], [catalog])
  const selected = choices.find(row => row.provider === value?.provider && row.model === value.model)
  const reasoning = selected?.reasoning
  const effectiveEffort = value?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning?.efforts.find(row => row.id === effectiveEffort)?.name ?? (effectiveEffort || undefined)
  const modelLabel = selected?.name ?? value?.model ?? fallbackLabel ?? t('triggerFallback')
  const chipLabel = compact && compactLabel !== undefined ? compactLabel : modelLabel
  const fullLabel = [controlLabel ?? roleLabel, modelLabel, effortLabel].filter(Boolean).join(' · ')
  const draftModel = choices.find(row => row.provider === draft?.provider && row.model === draft.model)
  const draftReasoning = draftModel?.reasoning
  // Effort stops: the provider-default state is the leftmost stop, so the
  // control always shows the route's real state instead of hiding it behind a
  // separate reset action. The rest are the model's own advertised levels.
  const effortStops: { id: string | undefined; name: string; description?: string }[] = draftReasoning === undefined
    ? []
    : [{ id: undefined, name: t('effortDefault') }, ...draftReasoning.efforts.map(level => ({ id: level.id as string | undefined, name: level.name, description: level.description }))]
  const effortIndex = Math.max(0, effortStops.findIndex(level => level.id === draft?.reasoningEffort))
  const close = (focus = false): void => {
    setOpen(false); if (focus) triggerRef.current?.focus()
  }
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (trigger === undefined) return
      const width = Math.min(360, window.innerWidth - 24)
      const above = trigger.top - 12
      const below = window.innerHeight - trigger.bottom - 12
      const upwards = placement === 'top' ? above >= 240 || above > below : below < 240 && above > below
      const height = Math.min(520, upwards ? above : below)
      const left = Math.max(12, Math.min(placement === 'top' ? trigger.right - width : trigger.left, window.innerWidth - width - 12))
      // Menu occupies only its contents; translateY preserves bottom anchoring.
      setPosition({ left, top: upwards ? trigger.top - 8 : trigger.bottom + 8, height: Math.max(160, height) })
      if (menuRef.current) menuRef.current.dataset.upwards = String(upwards)
    }
    place(); searchRef.current?.focus()
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close()
    }
    const dismissOnScroll = (event: Event): void => { if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', dismissOnScroll, true)
    window.addEventListener('resize', place)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', dismissOnScroll, true); window.removeEventListener('resize', place) }
  }, [open, placement])
  useEffect(() => { if (disabled) close() }, [disabled])
  useEffect(() => () => { if (effortTimer.current !== undefined) clearTimeout(effortTimer.current) }, [])
  const sameSelection = (a: ModelSelectionConfig | undefined, b: ModelSelectionConfig | undefined): boolean =>
    a?.provider === b?.provider && a?.model === b?.model && a?.reasoningEffort === b?.reasoningEffort
  const commit = (action: () => void | Promise<void>, next?: ModelSelectionConfig): void => {
    if (disabled) return
    inFlightRef.current += 1
    setSaving(true); setError(null)
    const run = chainRef.current.then(() => action())
    chainRef.current = run.then(() => undefined, () => undefined)
    void run.then(() => { if (next) modelPreferences.remember(next) }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      // Roll the optimistic draft back to the last value the host accepted.
      setDraft(valueRef.current === undefined ? undefined : { ...valueRef.current })
    }).finally(() => {
      inFlightRef.current -= 1
      if (inFlightRef.current <= 0) { inFlightRef.current = 0; setSaving(false) }
    })
  }
  const pick = (provider: string, model: string): void => {
    if (disabled) return
    const row = choices.find(item => item.provider === provider && item.model === model)
    // Re-selecting the same model keeps its explicit effort. A different
    // model starts with its own default, never an unsupported prior effort.
    const next = draft?.provider === provider && draft.model === model
      ? { ...draft }
      : value?.provider === provider && value.model === model
        ? { ...value }
        : { provider, model, ...row?.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: row.reasoning.defaultEffort } }
    setDraft(next)
    if (!sameSelection(next, value)) commit(() => onChangeRef.current(next), next)
  }
  /** Effort drags update the UI at once and commit once the drag settles. */
  const pickEffort = (next: ModelSelectionConfig): void => {
    setDraft(next)
    if (effortTimer.current !== undefined) clearTimeout(effortTimer.current)
    effortTimer.current = setTimeout(() => {
      effortTimer.current = undefined
      if (!sameSelection(next, valueRef.current)) commit(() => onChangeRef.current(next), next)
    }, 150)
  }
  const clearRoute = (): void => {
    if (disabled || onClear === undefined) return
    commit(onClear)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return }
    if (event.key === 'Tab') {
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])
      const at = items.indexOf(document.activeElement as HTMLElement)
      if ((!event.shiftKey && at === items.length - 1) || (event.shiftKey && at === 0)) {
        event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus()
      }
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if (event.target === searchRef.current && ['Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-model-option]:not(:disabled)') ?? [])
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : at <= 0 ? items.length - 1 : at - 1
    items[next]?.focus()
  }
  const normalized = query.trim().toLocaleLowerCase()
  const { visible, groups } = useMemo(() => {
    const matches = choices.filter(row => `${row.name} ${row.model} ${row.providerName} ${row.provider}`.toLocaleLowerCase().includes(normalized))
    return {
      visible: matches,
      groups: normalized ? [{ label: t('searchResults'), rows: matches }] : [
        { label: t('favorites'), rows: choices.filter(row => preferences.favorites.includes(modelKey(row))) },
        { label: t('recentModels'), rows: preferences.recent.flatMap(key => choices.filter(row => modelKey(row) === key)) },
        ...(catalog?.groups.map(group => ({ label: group.name, rows: choices.filter(row => row.provider === group.id) })) ?? []),
      ],
    }
  }, [choices, normalized, preferences, catalog, t])
  if (requireSession && sessionId === undefined) return <p className={css.muted}>{t('noSession')}</p>
  return (
    <div className={[css.root, compact ? css.compact : undefined, stretch ? css.stretch : undefined, className].filter(Boolean).join(' ')}>
      <button ref={triggerRef} type="button" className={css.trigger} aria-label={fullLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} title={fullLabel} disabled={disabled} onClick={() => {
        if (open) close(); else { setQuery(''); setDraft(value === undefined ? undefined : { ...value }); setError(null); setOpen(true); load() }
      }}>
        {roleIcon !== undefined
          ? <span className={css.roleIcon}>{roleIcon}</span>
          : roleLabel && <span className={css.role}>{roleLabel}</span>}
        <span className={css.triggerLabel}>{chipLabel}</span>
        {effortLabel && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutlineRegular className={css.chevron} />
      </button>
      {open && createPortal(
        <div ref={menuRef} id={id} role="dialog" aria-modal="true" aria-label={controlLabel ?? roleLabel ?? t('menuAria')} className={css.menu} style={{ left: position.left, top: position.top, maxHeight: position.height }} onKeyDown={onKeyDown}>
          <header className={css.menuHeader}>
            <span>{controlLabel ?? roleLabel ?? t('menuAria')}</span>
            {sourceLabel && <span className={css.source}>{sourceLabel}</span>}
          </header>
          <div className={css.searchRow}>
            <input ref={searchRef} className={[css.search, query !== '' ? css.searchWithQuery : ''].filter(Boolean).join(' ')} value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
            {query !== '' && <button type="button" className={css.searchClear} aria-label={t('searchClear')} onClick={() => { setQuery(''); searchRef.current?.focus() }}><IconCloseFillRegular /></button>}
          </div>
          {error && <div className={css.error} role="alert"><span>{error}</span><button type="button" className={css.retry} onClick={load}>{t('retry')}</button></div>}
          {catalog && value && !selected && !loading && <div className={css.warning} role="alert">{t('routeMissing')} ({value.provider}/{value.model})</div>}
          {catalog?.failures.length ? <div className={css.warning}>{t('catalogPartial')}: {catalog.failures.map(row => row.name).join(', ')}</div> : null}
          <div className={css.groups} aria-busy={loading || saving}>
            {loading && !catalog && <div className={css.status}>{t('statusLoading')}</div>}
            {groups.filter(group => group.rows.length).map(group => <section className={css.group} key={group.label} aria-label={group.label}>
              <h4 className={css.groupTitle}>{group.label}</h4>
              {group.rows.map(row => {
                const key = modelKey(row)
                const favorite = preferences.favorites.includes(key)
                const current = row.provider === draft?.provider && row.model === draft.model
                return <div className={css.modelRow} key={key}>
                  <button type="button" data-model-option className={[css.option, current ? css.selected : ''].filter(Boolean).join(' ')} aria-pressed={current} disabled={disabled} title={`${row.name} · ${row.providerName}`} onClick={() => { pick(row.provider, row.model) }}>
                    <span className={css.optionCopy}><span className={css.modelName}>{row.name}</span><span className={css.description}>{normalized || group.label === t('favorites') || group.label === t('recentModels') ? `${row.providerName} · ` : ''}{row.description ?? row.model}</span></span>
                    {current && <IconCheckOutlineRegular className={css.check} />}
                  </button>
                  <button type="button" className={css.favorite} aria-label={`${t(favorite ? 'unfavoriteModel' : 'favoriteModel')}: ${row.name}`} aria-pressed={favorite} onClick={() => { modelPreferences.toggleFavorite(row) }}><IconStar filled={favorite} /></button>
                </div>
              })}
            </section>)}
            {!loading && visible.length === 0 && <div className={css.empty}>{t(normalized ? 'noResults' : 'emptyModels')}</div>}
          </div>
          {onClear && <button className={css.clear} type="button" disabled={disabled} onClick={clearRoute}>{clearLabel ?? t('sessionPickerClear')}</button>}
          <div className={css.selectionEditor}>
            <div className={css.draftSummary}>
              <span className={css.modelName}>{draftModel?.name ?? draft?.model ?? t('triggerFallback')}</span>
              {draftModel && <span className={css.description}>{draftModel.providerName}</span>}
            </div>
            {draftModel && (draftReasoning && draftReasoning.efforts.length > 0 ? <section className={css.effortSection} aria-label={t('effortLabel')}>
              <div className={css.effortHead}>
                <span className={css.effortLabel}>{t('effortLabel')}</span>
                <span className={css.effortValue}>{effortStops[effortIndex]?.name}</span>
              </div>
              <div className={css.slider}>
                <div className={css.sliderRail} aria-hidden>
                  <span className={css.sliderFill} style={{ width: `${effortStops.length > 1 ? (effortIndex / (effortStops.length - 1)) * 100 : 0}%` }} />
                  {effortStops.map((level, index) => <span key={level.id ?? 'default'} className={css.sliderTick} style={{ left: `${effortStops.length > 1 ? (index / (effortStops.length - 1)) * 100 : 0}%` }} title={level.description ?? level.name} />)}
                </div>
                <input
                  type="range"
                  className={css.range}
                  min={0}
                  max={effortStops.length - 1}
                  step={1}
                  value={effortIndex}
                  disabled={disabled}
                  aria-label={t('effortLabel')}
                  aria-valuetext={effortStops[effortIndex]?.name}
                  onChange={event => {
                    if (draft === undefined) return
                    const level = effortStops[Number(event.target.value)]
                    if (level === undefined) return
                    pickEffort({ provider: draft.provider, model: draft.model, ...level.id === undefined ? {} : { reasoningEffort: level.id } })
                  }}
                />
              </div>
            </section> : <p className={css.effortUnavailable}>{t('emptyEfforts')}</p>)}
          </div>
          {scopeHint && <footer className={css.scopeHint}>{scopeHint}</footer>}
        </div>, document.body,
      )}
    </div>
  )
}
