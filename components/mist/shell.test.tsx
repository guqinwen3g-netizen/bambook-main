// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LayoutGrid } from 'lucide-react';
import { MistAppShell, MistSidebarPresentation, MistTopbar } from './shell';

it('opens the mobile navigation from the topbar, closes it after navigating, and offers a back button on sub pages', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), navigate = vi.fn(), back = vi.fn();
  try {
    act(() => root.render(<MistAppShell
      sidebar={<MistSidebarPresentation sections={[{ id: 'g', label: '我的事务', items: [{ id: 'cockpit', label: '我的工作', icon: LayoutGrid, count: 2 }] }]} activeId="cockpit" onNavigate={navigate} collapsed={false} onToggleCollapsed={() => {}} account={{ name: '顾言' }} />}
      topbar={() => <MistTopbar crumbs={[{ label: '订单履约' }, { label: '开发与寻样' }, { label: 'DEV-1' }]} onBack={back} backLabel="返回开发与寻样" />}>
      <p>内容</p>
    </MistAppShell>));
    const side = host.querySelector('.mist-side') as HTMLElement;
    expect(side.dataset.menuOpen).toBeUndefined();
    act(() => (host.querySelector('[aria-label="打开菜单"]') as HTMLButtonElement).click());
    expect(side.dataset.menuOpen).toBe('true');
    expect(host.querySelector('[aria-label="打开菜单"]')!.getAttribute('aria-expanded')).toBe('true');
    act(() => (host.querySelector('.mist-nav-item') as HTMLButtonElement).click());
    expect(navigate).toHaveBeenCalledWith('cockpit');
    expect(side.dataset.menuOpen).toBeUndefined();
    act(() => (host.querySelector('[aria-label="打开菜单"]') as HTMLButtonElement).click());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(side.dataset.menuOpen).toBeUndefined();
    act(() => (host.querySelector('[aria-label="返回开发与寻样"]') as HTMLButtonElement).click());
    expect(back).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.mist-topbar')!.getAttribute('data-has-back')).toBe('true');
  } finally { act(() => root.unmount()); host.remove(); }
});

it('uses the brand mark as the mobile menu trigger and opens the menu with a left-edge swipe', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const mm = window.matchMedia; window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as any;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const touch = (type: 'touchstart' | 'touchend', x: number, y = 200) => {
    const e = new Event(type, { bubbles: true }) as any; const t = [{ clientX: x, clientY: y }];
    e.touches = type === 'touchstart' ? t : []; e.changedTouches = t; host.querySelector('.mist-app')!.dispatchEvent(e);
  };
  try {
    act(() => root.render(<MistAppShell
      sidebar={<MistSidebarPresentation sections={[{ id: 'g', label: '我的事务', items: [{ id: 'cockpit', label: '我的工作', icon: LayoutGrid }] }]} activeId="cockpit" onNavigate={() => {}} collapsed={false} onToggleCollapsed={() => {}} account={{ name: '顾言' }} />}
      topbar={() => <MistTopbar crumbs={[{ label: '我的工作' }]} />}><p>内容</p></MistAppShell>));
    const side = host.querySelector('.mist-side') as HTMLElement;
    expect(host.querySelector('[aria-label="打开菜单"] .mist-top-menu-mark')).not.toBeNull();
    act(() => { touch('touchstart', 120); touch('touchend', 260); });
    expect(side.dataset.menuOpen).toBeUndefined();
    act(() => { touch('touchstart', 8); touch('touchend', 120); });
    expect(side.dataset.menuOpen).toBe('true');
    act(() => { touch('touchstart', 260); touch('touchend', 100); });
    expect(side.dataset.menuOpen).toBeUndefined();
  } finally { act(() => root.unmount()); host.remove(); window.matchMedia = mm; }
});

it('opens the organization menu in collapsed navigation and handles keyboard focus', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Example() {
    const [open, setOpen] = React.useState(false);
    return <MistSidebarPresentation sections={[]} activeId="account" onNavigate={() => {}} collapsed onToggleCollapsed={() => {}} account={{name:'Test'}} workspace={{symbol:'T',name:'Team',caption:'当前小组',expanded:open,onClick:()=>setOpen(value=>!value),disclosure:<><button role="menuitemradio" aria-checked="true">All</button><button role="menuitemradio">One</button></>}} />;
  }
  try {
    act(() => root.render(<Example/>));
    const trigger = host.querySelector<HTMLButtonElement>('.mist-ws')!;
    act(() => trigger.click());
    const panel = host.querySelector<HTMLElement>('#mist-organization')!;
    expect(panel.getAttribute('role')).toBe('menu');
    expect(document.activeElement?.textContent).toBe('All');
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
    expect(document.activeElement?.textContent).toBe('One');
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(host.querySelector('#mist-organization')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally { act(() => root.unmount()); host.remove(); }
});

it('closes a department-only menu with Escape even when it has no focusable items', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Example() {
    const [open, setOpen] = React.useState(false);
    return <MistSidebarPresentation sections={[]} activeId="account" onNavigate={()=>{}} collapsed={false} onToggleCollapsed={()=>{}} account={{name:'Test'}} workspace={{symbol:'D',name:'Department',expanded:open,onClick:()=>setOpen(value=>!value),disclosure:<p>No groups</p>}}/>;
  }
  try {
    act(()=>root.render(<Example/>));
    const trigger=host.querySelector<HTMLButtonElement>('.mist-ws')!;
    act(()=>{trigger.focus();trigger.click();});
    expect(host.querySelector('#mist-organization')).not.toBeNull();
    act(()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(host.querySelector('#mist-organization')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally { act(()=>root.unmount());host.remove(); }
});
