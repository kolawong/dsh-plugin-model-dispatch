import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** One searchable, keyboard-accessible model menu shared by every surface. */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCloseFillRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { modelKey, modelPreferences } from "./model-preferences.js";
import { IconStar } from "./IconStar.js";
import css from './ModelPicker.module.css';
export function ModelPicker({ sessionId, access, value, onChange, t, disabled, className, placement = 'bottom', fallbackLabel, requireSession = false, roleLabel, controlLabel, stretch = false, scopeHint, sourceLabel, onClear, clearLabel, compact = false, compactLabel, roleIcon }) {
    const [catalog, setCatalog] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [draft, setDraft] = useState();
    const [position, setPosition] = useState({ left: 0, top: 0, height: 480 });
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const searchRef = useRef(null);
    const loadRevision = useRef(0);
    const preferences = useSyncExternalStore(modelPreferences.subscribe, modelPreferences.getSnapshot);
    const id = useId();
    // Live apply: every choice writes through on the spot, so the menu carries no
    // confirm row. Writes are chained (one host call at a time) and the effort
    // slider coalesces a drag before it commits.
    const chainRef = useRef(Promise.resolve());
    const inFlightRef = useRef(0);
    const effortTimer = useRef(undefined);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const valueRef = useRef(value);
    valueRef.current = value;
    const load = () => {
        const revision = ++loadRevision.current;
        setLoading(true);
        setError(null);
        void access.loadCatalog().then(next => {
            if (revision === loadRevision.current) {
                setCatalog(next);
                setLoading(false);
            }
        }).catch((cause) => {
            if (revision === loadRevision.current) {
                setError(cause instanceof Error ? cause.message : String(cause));
                setLoading(false);
            }
        });
    };
    useEffect(() => { load(); return () => { loadRevision.current += 1; }; }, [access]);
    const choices = useMemo(() => catalog?.groups.flatMap(group => group.models.map(model => ({
        ...model, provider: group.id, providerName: group.name, model: model.id,
    }))) ?? [], [catalog]);
    const selected = choices.find(row => row.provider === value?.provider && row.model === value.model);
    const reasoning = selected?.reasoning;
    const effectiveEffort = value?.reasoningEffort ?? reasoning?.defaultEffort;
    const effortLabel = reasoning?.efforts.find(row => row.id === effectiveEffort)?.name ?? (effectiveEffort || undefined);
    const modelLabel = selected?.name ?? value?.model ?? fallbackLabel ?? t('triggerFallback');
    const chipLabel = compact && compactLabel !== undefined ? compactLabel : modelLabel;
    const fullLabel = [controlLabel ?? roleLabel, modelLabel, effortLabel].filter(Boolean).join(' · ');
    const draftModel = choices.find(row => row.provider === draft?.provider && row.model === draft.model);
    const draftReasoning = draftModel?.reasoning;
    // Effort stops: the provider-default state is the leftmost stop, so the
    // control always shows the route's real state instead of hiding it behind a
    // separate reset action. The rest are the model's own advertised levels.
    const effortStops = draftReasoning === undefined
        ? []
        : [{ id: undefined, name: t('effortDefault') }, ...draftReasoning.efforts.map(level => ({ id: level.id, name: level.name, description: level.description }))];
    const effortIndex = Math.max(0, effortStops.findIndex(level => level.id === draft?.reasoningEffort));
    const close = (focus = false) => {
        setOpen(false);
        if (focus)
            triggerRef.current?.focus();
    };
    useLayoutEffect(() => {
        if (!open)
            return;
        const place = () => {
            const trigger = triggerRef.current?.getBoundingClientRect();
            if (trigger === undefined)
                return;
            const width = Math.min(360, window.innerWidth - 24);
            const above = trigger.top - 12;
            const below = window.innerHeight - trigger.bottom - 12;
            const upwards = placement === 'top' ? above >= 240 || above > below : below < 240 && above > below;
            const height = Math.min(520, upwards ? above : below);
            const left = Math.max(12, Math.min(placement === 'top' ? trigger.right - width : trigger.left, window.innerWidth - width - 12));
            // Menu occupies only its contents; translateY preserves bottom anchoring.
            setPosition({ left, top: upwards ? trigger.top - 8 : trigger.bottom + 8, height: Math.max(160, height) });
            if (menuRef.current)
                menuRef.current.dataset.upwards = String(upwards);
        };
        place();
        searchRef.current?.focus();
        const outside = (event) => {
            if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target))
                close();
        };
        const dismissOnScroll = (event) => { if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target))
            close(); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('scroll', dismissOnScroll, true);
        window.addEventListener('resize', place);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', dismissOnScroll, true); window.removeEventListener('resize', place); };
    }, [open, placement]);
    useEffect(() => { if (disabled)
        close(); }, [disabled]);
    useEffect(() => () => { if (effortTimer.current !== undefined)
        clearTimeout(effortTimer.current); }, []);
    const sameSelection = (a, b) => a?.provider === b?.provider && a?.model === b?.model && a?.reasoningEffort === b?.reasoningEffort;
    const commit = (action, next) => {
        if (disabled)
            return;
        inFlightRef.current += 1;
        setSaving(true);
        setError(null);
        const run = chainRef.current.then(() => action());
        chainRef.current = run.then(() => undefined, () => undefined);
        void run.then(() => { if (next)
            modelPreferences.remember(next); }).catch((cause) => {
            setError(cause instanceof Error ? cause.message : String(cause));
            // Roll the optimistic draft back to the last value the host accepted.
            setDraft(valueRef.current === undefined ? undefined : { ...valueRef.current });
        }).finally(() => {
            inFlightRef.current -= 1;
            if (inFlightRef.current <= 0) {
                inFlightRef.current = 0;
                setSaving(false);
            }
        });
    };
    const pick = (provider, model) => {
        if (disabled)
            return;
        const row = choices.find(item => item.provider === provider && item.model === model);
        // Re-selecting the same model keeps its explicit effort. A different
        // model starts with its own default, never an unsupported prior effort.
        const next = draft?.provider === provider && draft.model === model
            ? { ...draft }
            : value?.provider === provider && value.model === model
                ? { ...value }
                : { provider, model, ...row?.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: row.reasoning.defaultEffort } };
        setDraft(next);
        if (!sameSelection(next, value))
            commit(() => onChangeRef.current(next), next);
    };
    /** Effort drags update the UI at once and commit once the drag settles. */
    const pickEffort = (next) => {
        setDraft(next);
        if (effortTimer.current !== undefined)
            clearTimeout(effortTimer.current);
        effortTimer.current = setTimeout(() => {
            effortTimer.current = undefined;
            if (!sameSelection(next, valueRef.current))
                commit(() => onChangeRef.current(next), next);
        }, 150);
    };
    const clearRoute = () => {
        if (disabled || onClear === undefined)
            return;
        commit(onClear);
    };
    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
            return;
        }
        if (event.key === 'Tab') {
            const items = Array.from(menuRef.current?.querySelectorAll('input, button:not(:disabled)') ?? []);
            const at = items.indexOf(document.activeElement);
            if ((!event.shiftKey && at === items.length - 1) || (event.shiftKey && at === 0)) {
                event.preventDefault();
                items[event.shiftKey ? items.length - 1 : 0]?.focus();
            }
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
            return;
        if (event.target === searchRef.current && ['Home', 'End'].includes(event.key))
            return;
        event.preventDefault();
        const items = Array.from(menuRef.current?.querySelectorAll('[data-model-option]:not(:disabled)') ?? []);
        const at = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : at <= 0 ? items.length - 1 : at - 1;
        items[next]?.focus();
    };
    const normalized = query.trim().toLocaleLowerCase();
    const visible = choices.filter(row => `${row.name} ${row.model} ${row.providerName} ${row.provider}`.toLocaleLowerCase().includes(normalized));
    const groups = normalized ? [{ label: t('searchResults'), rows: visible }] : [
        { label: t('favorites'), rows: choices.filter(row => preferences.favorites.includes(modelKey(row))) },
        { label: t('recentModels'), rows: preferences.recent.flatMap(key => choices.filter(row => modelKey(row) === key)) },
        ...(catalog?.groups.map(group => ({ label: group.name, rows: choices.filter(row => row.provider === group.id) })) ?? []),
    ];
    if (requireSession && sessionId === undefined)
        return _jsx("p", { className: css.muted, children: t('noSession') });
    return (_jsxs("div", { className: [css.root, compact ? css.compact : undefined, stretch ? css.stretch : undefined, className].filter(Boolean).join(' '), children: [_jsxs("button", { ref: triggerRef, type: "button", className: css.trigger, "aria-label": fullLabel, "aria-haspopup": "dialog", "aria-expanded": open, "aria-controls": open ? id : undefined, title: fullLabel, disabled: disabled, onClick: () => {
                    if (open)
                        close();
                    else {
                        setQuery('');
                        setDraft(value === undefined ? undefined : { ...value });
                        setError(null);
                        setOpen(true);
                        load();
                    }
                }, children: [roleIcon !== undefined
                        ? _jsx("span", { className: css.roleIcon, children: roleIcon })
                        : roleLabel && _jsx("span", { className: css.role, children: roleLabel }), _jsx("span", { className: css.triggerLabel, children: chipLabel }), effortLabel && _jsx("span", { className: css.triggerEffort, children: effortLabel }), _jsx(IconChevronDownOutlineRegular, { className: css.chevron })] }), open && createPortal(_jsxs("div", { ref: menuRef, id: id, role: "dialog", "aria-modal": "true", "aria-label": controlLabel ?? roleLabel ?? t('menuAria'), className: css.menu, style: { left: position.left, top: position.top, maxHeight: position.height }, onKeyDown: onKeyDown, children: [_jsxs("header", { className: css.menuHeader, children: [_jsx("span", { children: controlLabel ?? roleLabel ?? t('menuAria') }), sourceLabel && _jsx("span", { className: css.source, children: sourceLabel })] }), _jsxs("div", { className: css.searchRow, children: [_jsx("input", { ref: searchRef, className: [css.search, query !== '' ? css.searchWithQuery : ''].filter(Boolean).join(' '), value: query, onChange: event => { setQuery(event.target.value); }, placeholder: t('searchPlaceholder'), "aria-label": t('searchPlaceholder') }), query !== '' && _jsx("button", { type: "button", className: css.searchClear, "aria-label": t('searchClear'), onClick: () => { setQuery(''); searchRef.current?.focus(); }, children: _jsx(IconCloseFillRegular, {}) })] }), error && _jsxs("div", { className: css.error, role: "alert", children: [_jsx("span", { children: error }), _jsx("button", { type: "button", className: css.retry, onClick: load, children: t('retry') })] }), catalog && value && !selected && !loading && _jsxs("div", { className: css.warning, role: "alert", children: [t('routeMissing'), " (", value.provider, "/", value.model, ")"] }), catalog?.failures.length ? _jsxs("div", { className: css.warning, children: [t('catalogPartial'), ": ", catalog.failures.map(row => row.name).join(', ')] }) : null, _jsxs("div", { className: css.groups, "aria-busy": loading || saving, children: [loading && !catalog && _jsx("div", { className: css.status, children: t('statusLoading') }), groups.filter(group => group.rows.length).map(group => _jsxs("section", { className: css.group, "aria-label": group.label, children: [_jsx("h4", { className: css.groupTitle, children: group.label }), group.rows.map(row => {
                                        const key = modelKey(row);
                                        const favorite = preferences.favorites.includes(key);
                                        const current = row.provider === draft?.provider && row.model === draft.model;
                                        return _jsxs("div", { className: css.modelRow, children: [_jsxs("button", { type: "button", "data-model-option": true, className: [css.option, current ? css.selected : ''].filter(Boolean).join(' '), "aria-pressed": current, disabled: disabled, title: `${row.name} · ${row.providerName}`, onClick: () => { pick(row.provider, row.model); }, children: [_jsxs("span", { className: css.optionCopy, children: [_jsx("span", { className: css.modelName, children: row.name }), _jsxs("span", { className: css.description, children: [normalized || group.label === t('favorites') || group.label === t('recentModels') ? `${row.providerName} · ` : '', row.description ?? row.model] })] }), current && _jsx(IconCheckOutlineRegular, { className: css.check })] }), _jsx("button", { type: "button", className: css.favorite, "aria-label": `${t(favorite ? 'unfavoriteModel' : 'favoriteModel')}: ${row.name}`, "aria-pressed": favorite, onClick: () => { modelPreferences.toggleFavorite(row); }, children: _jsx(IconStar, { filled: favorite }) })] }, key);
                                    })] }, group.label)), !loading && visible.length === 0 && _jsx("div", { className: css.empty, children: t(normalized ? 'noResults' : 'emptyModels') })] }), onClear && _jsx("button", { className: css.clear, type: "button", disabled: disabled, onClick: clearRoute, children: clearLabel ?? t('sessionPickerClear') }), _jsxs("div", { className: css.selectionEditor, children: [_jsxs("div", { className: css.draftSummary, children: [_jsx("span", { className: css.modelName, children: draftModel?.name ?? draft?.model ?? t('triggerFallback') }), draftModel && _jsx("span", { className: css.description, children: draftModel.providerName })] }), draftModel && (draftReasoning && draftReasoning.efforts.length > 0 ? _jsxs("section", { className: css.effortSection, "aria-label": t('effortLabel'), children: [_jsxs("div", { className: css.effortHead, children: [_jsx("span", { className: css.effortLabel, children: t('effortLabel') }), _jsx("span", { className: css.effortValue, children: effortStops[effortIndex]?.name })] }), _jsxs("div", { className: css.slider, children: [_jsxs("div", { className: css.sliderRail, "aria-hidden": true, children: [_jsx("span", { className: css.sliderFill, style: { width: `${effortStops.length > 1 ? (effortIndex / (effortStops.length - 1)) * 100 : 0}%` } }), effortStops.map((level, index) => _jsx("span", { className: css.sliderTick, style: { left: `${effortStops.length > 1 ? (index / (effortStops.length - 1)) * 100 : 0}%` }, title: level.description ?? level.name }, level.id ?? 'default'))] }), _jsx("input", { type: "range", className: css.range, min: 0, max: effortStops.length - 1, step: 1, value: effortIndex, disabled: disabled, "aria-label": t('effortLabel'), "aria-valuetext": effortStops[effortIndex]?.name, onChange: event => {
                                                    if (draft === undefined)
                                                        return;
                                                    const level = effortStops[Number(event.target.value)];
                                                    if (level === undefined)
                                                        return;
                                                    pickEffort({ provider: draft.provider, model: draft.model, ...level.id === undefined ? {} : { reasoningEffort: level.id } });
                                                } })] })] }) : _jsx("p", { className: css.effortUnavailable, children: t('emptyEfforts') }))] }), scopeHint && _jsx("footer", { className: css.scopeHint, children: scopeHint })] }), document.body)] }));
}
