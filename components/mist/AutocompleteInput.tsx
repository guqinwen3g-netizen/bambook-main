import React from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './primitives';
import { useMistPortalTarget } from './shell';
import { cx } from './types';

type Props = React.InputHTMLAttributes<HTMLInputElement> & { list: string; icon?: LucideIcon; suffix?: React.ReactNode };

/** Existing datalist data, rendered in the same themed popup as other choices. */
export const AutocompleteInput = React.forwardRef<HTMLInputElement, Props>(function AutocompleteInput({ list, icon, suffix, className, disabled, readOnly, onFocus, onBlur, onChange, onKeyDown, ...rest }, forwardedRef) {
  const input = React.useRef<HTMLInputElement>(null), menu = React.useRef<HTMLDivElement>(null), portal = useMistPortalTarget();
  const generated = React.useId(), inputId = rest.id ?? `${generated}-input`, menuId = `${generated}-list`;
  const [open, setOpen] = React.useState(false), [query, setQuery] = React.useState(''), [active, setActive] = React.useState(-1);
  const [position, setPosition] = React.useState<React.CSSProperties>({ left: 0, top: 0 });
  const setInput = React.useCallback((node: HTMLInputElement | null) => { input.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }, [forwardedRef]);
  const datalist = typeof document === 'undefined' ? null : document.getElementById(list) as HTMLDataListElement | null;
  const values = Array.from(datalist?.options ?? []).map(option => ({ value: option.value, label: option.label || option.textContent || option.value })).filter(item => item.value && `${item.value} ${item.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visible = open && !disabled && !readOnly && values.length > 0;
  const choose = (index: number) => {
    const node = input.current, value = values[index]?.value; if (!node || value === undefined) return;
    if (node.value !== value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }
    setQuery(value); setOpen(false); setActive(-1); node.focus();
  };
  React.useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const anchor = input.current?.closest('.mist-input')?.getBoundingClientRect(); if (!anchor) return;
      const width = Math.min(anchor.width, Math.max(0, window.innerWidth - 16)), height = menu.current?.getBoundingClientRect().height ?? 0, below = anchor.bottom + 6;
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), top: below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - height - 6), width, minWidth: 0, maxHeight: 'min(360px, calc(100vh - 16px))', overflowY: 'auto' });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [visible, portal, values.length]);
  React.useEffect(() => {
    if (!visible) return;
    const outside = (event: MouseEvent) => { if (!input.current?.closest('.mist-input')?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside); return () => document.removeEventListener('mousedown', outside);
  }, [visible]);
  return <span className={cx('mist-input', className)} data-disabled={disabled || undefined}>
    {icon && <Icon icon={icon} size="sm" />}
    <input {...rest} id={inputId} ref={setInput} disabled={disabled} readOnly={readOnly} autoComplete={rest.autoComplete ?? 'off'} role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? menuId : undefined} aria-activedescendant={visible && active >= 0 ? `${menuId}-${active}` : undefined}
      onFocus={event => { onFocus?.(event); if (!disabled && !readOnly) { setQuery(event.currentTarget.value); setOpen(true); setActive(-1); } }}
      onBlur={event => { onBlur?.(event); setOpen(false); }}
      onChange={event => { onChange?.(event); setQuery(event.currentTarget.value); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        onKeyDown?.(event); if (event.defaultPrevented || !visible) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => event.key === 'ArrowDown' ? Math.min(values.length - 1, index + 1) : index < 0 ? values.length - 1 : Math.max(0, index - 1)); }
        else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(active); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        else if (event.key === 'Tab') setOpen(false);
      }} />
    {suffix && <span className="mist-input-suffix">{suffix}</span>}
    {visible && createPortal(<div ref={menu} id={menuId} className="mist-menu mist-autocomplete-menu" role="listbox" aria-labelledby={inputId} style={position} data-mist-owner={input.current?.closest('[role="dialog"]')?.id || undefined}>
      {values.map((item, index) => <button key={`${item.value}:${index}`} type="button" id={`${menuId}-${index}`} role="option" tabIndex={-1} aria-selected={index === active} onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><span>{item.label}</span>{item.label !== item.value && <small>{item.value}</small>}</button>)}
    </div>, portal ?? document.body)}
  </span>;
});
