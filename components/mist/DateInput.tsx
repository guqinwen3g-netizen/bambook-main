import React from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, type LucideIcon } from 'lucide-react';
import { interfaceLocale, uiText } from '../../services/interfaceLanguage';
import { Icon } from './primitives';
import { useMistPortalTarget } from './shell';
import { cx } from './types';

type Props = React.InputHTMLAttributes<HTMLInputElement> & { type: 'date' | 'datetime-local' | 'month' | 'time'; icon?: LucideIcon; suffix?: React.ReactNode };
const isoDay = (date: Date) => `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function monthFor(value: string) {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (match) { const date = new Date(Number(match[1]), Number(match[2]) - 1, 1); if (date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1) return date; }
  const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1);
}
function inRange(day: string, min?: string | number, max?: string | number) { return (!min || day >= String(min).slice(0, 10)) && (!max || day <= String(max).slice(0, 10)); }
function monthInRange(value: string, min?: string | number, max?: string | number) { return (!min || value >= String(min).slice(0, 7)) && (!max || value <= String(max).slice(0, 7)); }
function validTime(value: string) { const match = /^(\d{2}):(\d{2})$/.exec(value); return !!match && Number(match[1]) < 24 && Number(match[2]) < 60; }

/** A themed calendar while the real input remains responsible for form validation. */
export const DateInput = React.forwardRef<HTMLInputElement, Props>(function DateInput({ type, icon, suffix, className, disabled, readOnly, onPointerDown, onClick, onKeyDown, ...rest }, forwardedRef) {
  const input = React.useRef<HTMLInputElement>(null), picker = React.useRef<HTMLDivElement>(null), portal = useMistPortalTarget();
  const id = React.useId(), pickerId = `${id}-calendar`, triggerId = rest.id ?? `${id}-input`;
  const [open, setOpen] = React.useState(false), [month, setMonth] = React.useState(() => monthFor(''));
  const [selected, setSelected] = React.useState(''), [active, setActive] = React.useState(''), [time, setTime] = React.useState('');
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 0, top: 0 });
  const setInput = React.useCallback((node: HTMLInputElement | null) => { input.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }, [forwardedRef]);
  const close = (restore = true) => { setOpen(false); if (restore) input.current?.focus(); };
  const show = () => {
    if (disabled || readOnly) return;
    const current = input.current?.value ?? '', today = isoDay(new Date()), precision = type === 'month' ? 7 : 10, reference = today.slice(0, precision);
    const initial = type === 'time' ? '' : current || (rest.min && reference < String(rest.min).slice(0, precision) ? String(rest.min) : rest.max && reference > String(rest.max).slice(0, precision) ? String(rest.max) : '');
    setMonth(monthFor(initial)); setSelected(current.slice(0, precision)); setActive((initial || today).slice(0, precision)); setTime(type === 'time' ? current.slice(0, 5) : current.match(/T(\d{2}:\d{2})/)?.[1] ?? ''); setOpen(true);
  };
  const setNativeValue = (value: string) => {
    const node = input.current; if (!node || node.value === value) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const apply = (day: string) => { setNativeValue(day); close(); };
  React.useEffect(() => { if (disabled || readOnly) setOpen(false); }, [disabled, readOnly]);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = input.current?.closest('.mist-input')?.getBoundingClientRect(); if (!anchor) return;
      const width = Math.min(320, Math.max(0, window.innerWidth - 16)), height = picker.current?.getBoundingClientRect().height ?? 0, below = anchor.bottom + 6;
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), top: below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - height - 6), width, minWidth: 0, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    const chosen = Array.from(picker.current?.querySelectorAll<HTMLButtonElement>('[data-date]:not(:disabled), [data-month]:not(:disabled)') ?? []).find(item => (item.dataset.date || item.dataset.month) === active);
    (chosen ?? picker.current?.querySelector<HTMLButtonElement>('[data-date]:not(:disabled), [data-month]:not(:disabled)') ?? picker.current?.querySelector<HTMLInputElement>('[data-time-entry]') ?? picker.current)?.focus();
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, portal, month]);
  React.useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!input.current?.closest('.mist-input')?.contains(event.target as Node) && !picker.current?.contains(event.target as Node)) close(false); };
    document.addEventListener('mousedown', outside); return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1), firstOffset = (first.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: count }, (_, index) => isoDay(new Date(month.getFullYear(), month.getMonth(), index + 1)));
  const monthLabel = new Intl.DateTimeFormat(interfaceLocale(), type === 'month' ? { year: 'numeric' } : { year: 'numeric', month: 'long' }).format(first);
  const weekdays = interfaceLocale() === 'en-US' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['一', '二', '三', '四', '五', '六', '日'];
  const candidate = validTime(time) ? type === 'time' ? time : selected ? `${selected}T${time}` : '' : '';
  const validCandidate = !!candidate && (!rest.min || candidate >= String(rest.min)) && (!rest.max || candidate <= String(rest.max));
  const activeInMonth = days.includes(active) && inRange(active, rest.min, rest.max) ? active : days.find(day => inRange(day, rest.min, rest.max));
  const months = Array.from({ length: 12 }, (_, index) => `${String(month.getFullYear()).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`);
  const activeMonth = months.includes(active) && monthInRange(active, rest.min, rest.max) ? active : months.find(value => monthInRange(value, rest.min, rest.max));
  const pickerLabel = type === 'time' ? '选择时间' : type === 'month' ? '选择月份' : '选择日期';
  const pickerKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const day = (event.target as HTMLElement).dataset.date;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (day && offsets[event.key]) {
      event.preventDefault(); const [year, monthNumber, date] = day.split('-').map(Number), next = new Date(year, monthNumber - 1, date + offsets[event.key]), nextDay = isoDay(next);
      if (!inRange(nextDay, rest.min, rest.max)) return;
      setActive(nextDay);
      if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
      else Array.from(picker.current?.querySelectorAll<HTMLButtonElement>('[data-date]') ?? []).find(item => item.dataset.date === nextDay)?.focus();
      return;
    }
    const monthValue = (event.target as HTMLElement).dataset.month;
    const monthOffsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    if (monthValue && monthOffsets[event.key]) {
      event.preventDefault(); const [year, number] = monthValue.split('-').map(Number), next = new Date(year, number - 1 + monthOffsets[event.key], 1), value = isoDay(next).slice(0, 7);
      if (!monthInRange(value, rest.min, rest.max)) return;
      setActive(value);
      if (next.getFullYear() !== month.getFullYear()) setMonth(next);
      else Array.from(picker.current?.querySelectorAll<HTMLButtonElement>('[data-month]') ?? []).find(item => item.dataset.month === value)?.focus();
      return;
    }
    if (event.key !== 'Tab' || !picker.current) return;
    const inside = Array.from(picker.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]')).filter(element => element.tabIndex >= 0).sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const atEdge = event.shiftKey ? document.activeElement === inside[0] : document.activeElement === inside.at(-1);
    if (!atEdge) return;
    const scope = input.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body, wrapper = input.current?.closest('.mist-input');
    const focusable = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]')).filter(element => {
      if (element.tabIndex < 0 || element.closest('[hidden], [inert]') || picker.current?.contains(element) || (wrapper?.contains(element) && element !== input.current)) return false;
      for (let parent: HTMLElement | null = element; parent && parent !== scope.parentElement; parent = parent.parentElement) { const style = window.getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden') return false; }
      return true;
    }).sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const index = input.current ? focusable.indexOf(input.current) : -1;
    const next = focusable[index + (event.shiftKey ? -1 : 1)] ?? (scope !== document.body ? event.shiftKey ? focusable.at(-1) : focusable[0] : undefined);
    if (next) { event.preventDefault(); close(false); next.focus(); } else close();
  };
  return <span className={cx('mist-input', className)} data-disabled={disabled || undefined}>
    {icon && <Icon icon={icon} size="sm" />}
    <input {...rest} id={triggerId} type={type} ref={setInput} disabled={disabled} readOnly={readOnly} aria-expanded={open} aria-controls={open ? pickerId : undefined}
      onPointerDown={event => { onPointerDown?.(event); if (event.defaultPrevented || disabled || event.button !== 0) return; event.preventDefault(); input.current?.focus(); show(); }}
      onClick={event => { onClick?.(event); if (!disabled && !readOnly) { event.preventDefault(); if (event.detail === 0 && !open) show(); } }}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.altKey && event.key === 'ArrowDown') { event.preventDefault(); show(); } }} />
    {suffix && <span className="mist-input-suffix">{suffix}</span>}
    <button type="button" className="mist-date-trigger" aria-label={uiText(pickerLabel)} disabled={disabled || readOnly} onClick={() => open ? close() : show()}><Icon icon={type === 'time' ? Clock : CalendarDays} size="sm" /></button>
    {open && createPortal(<div ref={picker} id={pickerId} className="mist-menu mist-date-picker" role="dialog" aria-label={uiText(pickerLabel)} tabIndex={-1} style={position} data-mist-date-picker data-mist-owner={input.current?.closest('[role="dialog"]')?.id || undefined} onKeyDown={pickerKey}>
      {type !== 'time' && <div className="mist-date-head"><button type="button" aria-label={uiText(type === 'month' ? '上一年' : '上个月')} onClick={() => setMonth(value => new Date(value.getFullYear() - (type === 'month' ? 1 : 0), value.getMonth() - (type === 'month' ? 0 : 1), 1))}><Icon icon={ChevronLeft} size="sm" /></button><b>{monthLabel}</b><button type="button" aria-label={uiText(type === 'month' ? '下一年' : '下个月')} onClick={() => setMonth(value => new Date(value.getFullYear() + (type === 'month' ? 1 : 0), value.getMonth() + (type === 'month' ? 0 : 1), 1))}><Icon icon={ChevronRight} size="sm" /></button></div>}
      {(type === 'date' || type === 'datetime-local') && <div className="mist-date-grid" role="group" aria-label={uiText('日期')}>{weekdays.map(day => <span key={day} aria-hidden="true">{day}</span>)}{Array.from({ length: firstOffset }, (_, index) => <span key={`empty-${index}`} />)}{days.map(day => <button key={day} type="button" data-date={day} aria-label={day} aria-pressed={day === selected} tabIndex={day === activeInMonth ? 0 : -1} disabled={!inRange(day, rest.min, rest.max)} onFocus={() => setActive(day)} onClick={() => type === 'date' ? apply(day) : setSelected(day)}>{Number(day.slice(-2))}</button>)}</div>}
      {type === 'month' && <div className="mist-date-grid mist-month-grid" role="group" aria-label={uiText('月份')}>{months.map((value, index) => <button key={value} type="button" data-month={value} aria-label={value} aria-pressed={value === selected} tabIndex={value === activeMonth ? 0 : -1} disabled={!monthInRange(value, rest.min, rest.max)} onFocus={() => setActive(value)} onClick={() => apply(value)}>{new Intl.DateTimeFormat(interfaceLocale(), { month: 'short' }).format(new Date(month.getFullYear(), index, 1))}</button>)}</div>}
      {(type === 'datetime-local' || type === 'time') && <div className="mist-date-time"><span className="mist-input"><input data-time-entry aria-label={uiText('时间')} placeholder="HH:mm" inputMode="numeric" value={time} onChange={event => { const digits = event.target.value.replace(/\D/g, '').slice(0, 4); setTime(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits); }} /></span><button type="button" className="mist-btn" data-date-apply disabled={!validCandidate} onClick={() => apply(candidate)}>{uiText('确定')}</button></div>}
      {!!input.current?.value && <div className="mist-date-clear"><button type="button" className="mist-btn" data-variant="quiet" onClick={() => apply('')}>{uiText('清除')}</button></div>}
    </div>, portal ?? document.body)}
  </span>;
});
