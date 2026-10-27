import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { uiText } from '../../services/interfaceLanguage';
import { Icon } from './primitives';
import { useMistPortalTarget } from './shell';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  icon?: LucideIcon;
  options: Array<string | { value: string; label: string }>;
  placeholder?: string;
};

/** Keep the real select for form semantics while presenting its options in Mist. */
export function Select({ icon, options, placeholder, disabled, onPointerDown, onMouseDown, onClick, onKeyDown, ...rest }: SelectProps) {
  const trigger = React.useRef<HTMLSelectElement>(null), menu = React.useRef<HTMLDivElement>(null);
  const portal = useMistPortalTarget(), generatedId = React.useId();
  const selectId = rest.id ?? `${generatedId}-select`, menuId = `${generatedId}-list`;
  const [open, setOpen] = React.useState(false), [active, setActive] = React.useState(0);
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 0, top: 0 });
  const search = React.useRef(''), searchTimer = React.useRef<number | undefined>(undefined);
  const items = [...(placeholder ? [{ value: '', label: uiText(placeholder) }] : []), ...options.map(option => typeof option === 'string' ? { value: option, label: uiText(option) } : { value: option.value, label: uiText(option.label) })];
  const close = (restore = true) => { setOpen(false); search.current = ''; if (restore) trigger.current?.focus(); };
  const show = () => { if (disabled || !items.length) return; setActive(Math.max(0, trigger.current?.selectedIndex ?? 0)); setOpen(true); };
  const move = (index: number) => { setActive(index); const item = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]; item?.focus(); item?.scrollIntoView?.({ block: 'nearest' }); };
  const choose = (index: number) => {
    const select = trigger.current, value = items[index]?.value;
    if (!select || value === undefined) return;
    if (select.value !== value) { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }
    close();
  };
  React.useEffect(() => () => window.clearTimeout(searchTimer.current), []);
  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = (trigger.current?.closest('.mist-input') ?? trigger.current)?.getBoundingClientRect(); if (!anchor) return;
      const width = Math.min(anchor.width, Math.max(0, window.innerWidth - 16));
      const height = menu.current?.getBoundingClientRect().height ?? 0, below = anchor.bottom + 6;
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), top: below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - height - 6), width, minWidth: 0, maxHeight: 'min(360px, calc(100vh - 16px))', overflowY: 'auto' });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[active]?.focus();
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, portal]);
  React.useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close(false); };
    document.addEventListener('mousedown', outside); return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const navigate = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      if (items.length) move(next);
    } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') {
      const scope = trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
      const focusable = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]')).filter(element => {
        if (element.tabIndex < 0 || element.closest('[hidden], [inert]') || menu.current?.contains(element)) return false;
        for (let parent: HTMLElement | null = element; parent && parent !== scope.parentElement; parent = parent.parentElement) { const style = window.getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden') return false; }
        return true;
      }).sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const index = trigger.current ? focusable.indexOf(trigger.current) : -1;
      const next = focusable[index + (event.shiftKey ? -1 : 1)] ?? (scope !== document.body ? event.shiftKey ? focusable.at(-1) : focusable[0] : undefined);
      if (next) { event.preventDefault(); close(false); next.focus(); } else close();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      search.current += event.key.toLocaleLowerCase(); window.clearTimeout(searchTimer.current); searchTimer.current = window.setTimeout(() => { search.current = ''; }, 700);
      const index = items.findIndex(item => item.label.toLocaleLowerCase().startsWith(search.current)); if (index >= 0) { event.preventDefault(); move(index); }
    }
  };
  return <span className="mist-input" data-disabled={disabled || undefined}>
    {icon && <Icon icon={icon} size="sm" />}
    <select {...rest} id={selectId} ref={trigger} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onPointerDown={event => { onPointerDown?.(event); if (event.defaultPrevented || disabled || event.button !== 0) return; event.preventDefault(); trigger.current?.focus(); open ? close() : show(); }}
      onMouseDown={event => { onMouseDown?.(event); if (!event.defaultPrevented) event.preventDefault(); }}
      onClick={event => { onClick?.(event); event.preventDefault(); if (!disabled && event.detail === 0) open ? close() : show(); }}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); } }}>
      {items.map((item, index) => <option key={`${item.value}:${index}`} value={item.value}>{item.label}</option>)}
    </select>
    <Icon icon={ChevronDown} size="xs" />
    {open && createPortal(<div ref={menu} id={menuId} className="mist-menu mist-select-menu" role="listbox" aria-labelledby={selectId} style={position}
      data-mist-owner={trigger.current?.closest('[role="dialog"]')?.id || undefined} onKeyDown={navigate}>
      {items.map((item, index) => <button type="button" role="option" key={`${item.value}:${index}`} tabIndex={index === active ? 0 : -1} aria-selected={trigger.current?.value === item.value} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>{item.label}</button>)}
    </div>, portal ?? document.body)}
  </span>;
}
