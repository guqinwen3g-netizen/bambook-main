import { uiText, ui } from '../../services/interfaceLanguage';
import React from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, Bell, ChevronDown, ChevronRight, Menu, Moon, PanelLeft, Search, Sun, X } from 'lucide-react';
import { MistMark, MistWordmark } from './MistMark';
import { AIBadge, Avatar, Icon, IconButton, Kbd, plainText } from './primitives';
import { cx, type ThemeMode } from './types';
import { FormFooterTargetContext, FormFooterWidthContext } from './formFooter';

/* ───────────── Root / Theme ───────────── */
const PortalCtx = React.createContext<HTMLElement | null>(null);
export const useMistPortalTarget = () => React.useContext(PortalCtx);

/**
 * Mist 作用域根节点。所有 Mist 组件必须在它里面（token 只在此作用域生效）。
 * theme 不传 = 跟随宿主（html.dark / [data-theme=dark]）。
 */
export function MistRoot({ theme, children, className, style }: { theme?: ThemeMode; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null);
  return (
    <div ref={setEl} className={cx('mist-root', className)} data-theme={theme} style={style}>
      <PortalCtx.Provider value={el}>{uiText(children)}</PortalCtx.Provider>
    </div>
  );
}

/** 全局快捷键：useHotkey('k', open, { meta: true }) → ⌘K / Ctrl+K */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { meta?: boolean; shift?: boolean } = {}) {
  const cb = React.useRef(handler); cb.current = handler;
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (opts.meta && !(e.metaKey || e.ctrlKey)) return;
      if (opts.shift && !e.shiftKey) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      e.preventDefault(); cb.current(e);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [key, opts.meta, opts.shift]);
}

/* ───────────── Mobile navigation ───────────── */
/** 手机端（≤760px）侧栏改为全屏导航抽屉：由 MistAppShell 持有开关，顶栏菜单按钮打开，侧栏内跳转后关闭。 */
const MobileNavCtx = React.createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/* ───────────── Sidebar ───────────── */
export type NavItem = { id: string; label: string; icon: LucideIcon; count?: number };
export type NavSection = { id: string; label: string; items: NavItem[]; defaultClosed?: boolean };
export type SidebarPresentationProps = {
  sections: NavSection[];
  activeId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** lead：替代首字母方块的前置内容（小组头像串或部门图标容器）。 */
  workspace?: { symbol: string; lead?: React.ReactNode; name: string; caption?: string; onClick?: () => void; expanded?: boolean; disclosure?: React.ReactNode };
  account: { name: string; caption?: string; avatarUrl?: string; onClick?: () => void };
  onSearch?: () => void;
  assistant?: { title: string; text: React.ReactNode; onClick: () => void };
};
/** 侧栏（纯展示，无数据依赖）。生产环境用 MistSidebar（已接好模块注册表与权限）。 */
export function MistSidebarPresentation({ sections, activeId, onNavigate, collapsed, onToggleCollapsed, workspace, account, onSearch, assistant }: SidebarPresentationProps) {
  const [closed, setClosed] = React.useState<Record<string, boolean>>(() => Object.fromEntries(sections.map(s => [s.id, !!s.defaultClosed && !s.items.some(i => i.id === activeId)])));
  const menu = React.useContext(MobileNavCtx), open = !!menu?.open;
  const organizationButton = React.useRef<HTMLButtonElement>(null);
  const organizationPanel = React.useRef<HTMLDivElement>(null);
  const portalTarget = useMistPortalTarget();
  const [organizationPosition, setOrganizationPosition] = React.useState<React.CSSProperties>({});
  const dismissOrganization = (focus = true) => { if (workspace?.expanded) workspace.onClick?.(); if (focus) organizationButton.current?.focus(); };
  React.useLayoutEffect(() => {
    if (!workspace?.expanded || !workspace.disclosure) return;
    const position = () => {
      const rect = organizationButton.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 180));
      setOrganizationPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top, maxHeight: window.innerHeight - top - 8, overflowY: 'auto' });
    };
    position();
    (organizationPanel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? organizationPanel.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    window.addEventListener('resize', position);
    const outside = (event: PointerEvent) => { if (!organizationPanel.current?.contains(event.target as Node) && !organizationButton.current?.contains(event.target as Node)) dismissOrganization(false); };
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('pointerdown', outside); if (organizationPanel.current?.contains(document.activeElement)) organizationButton.current?.focus(); };
  }, [workspace?.expanded, portalTarget]);
  const organizationPopup = workspace?.disclosure && workspace.expanded ? <div ref={organizationPanel} id="mist-organization" className="mist-menu mist-organization mist-organization-popover" role="menu" aria-label={uiText('组织与小组')} style={organizationPosition} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissOrganization(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const items = [...(organizationPanel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault(); dismissOrganization(false);
      const items = [...document.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')].filter(el => !organizationPanel.current?.contains(el) && el.getClientRects().length);
      const index = items.indexOf(organizationButton.current!); items[index + (event.shiftKey ? -1 : 1)]?.focus();
    }
  }}>{workspace.disclosure}</div> : null;
  const close = () => menu?.setOpen(false);
  React.useEffect(() => { close(); }, [activeId]);
  // 手机导航抽屉：任何一次跳转后都收起；Esc 关闭。
  const within = <A extends unknown[]>(fn?: (...args: A) => void) => fn && ((...args: A) => { close(); fn(...args); });
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
  return (
    <aside className="mist-side" id="mist-side" data-menu-open={open || undefined}>
      <div className="mist-brand" {...(collapsed ? { role: 'button', tabIndex: 0, 'aria-label': '展开导航', onClick: onToggleCollapsed, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onToggleCollapsed(); } } : {})}>
        <MistMark /><MistWordmark />
        <button type="button" className="mist-side-toggle" aria-label={uiText("收起导航")} onClick={onToggleCollapsed}><Icon icon={PanelLeft} size="sm" /></button>
        <button type="button" className="mist-side-close" aria-label={uiText("关闭菜单")} onClick={close}><Icon icon={X} size="sm" /></button>
      </div>
      {workspace && <>
        <button ref={organizationButton} type="button" className="mist-ws" aria-label={[workspace.name, workspace.caption].filter(Boolean).join(" · ")} title={workspace.name} aria-expanded={workspace.disclosure ? !!workspace.expanded : undefined} aria-controls={workspace.disclosure ? 'mist-organization' : undefined} aria-haspopup={workspace.disclosure ? 'menu' : undefined} onKeyDown={event => { if (event.key === 'Escape' && workspace.expanded) { event.preventDefault(); dismissOrganization(); } else if (workspace.disclosure && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (!workspace.expanded) workspace.onClick?.(); } }} onClick={workspace.disclosure ? workspace.onClick : within(workspace.onClick)}>{workspace.lead ?? <span className="mist-ws-sym">{workspace.symbol}</span>}<div><b>{workspace.name}</b>{workspace.caption && <small>{uiText(workspace.caption)}</small>}</div><Icon icon={ChevronDown} size="sm" /></button>
        {organizationPopup && (portalTarget ? createPortal(organizationPopup, portalTarget) : organizationPopup)}
      </>}
      {onSearch && <button type="button" className="mist-side-search" onClick={within(onSearch)} title={uiText("搜索或跳转")}><Icon icon={Search} size="sm" /><span>{uiText("搜索或跳转")}</span><Kbd>⌘K</Kbd></button>}
      <nav className="mist-nav" aria-label={uiText("主导航")}>
        {sections.map(s => (
          <div key={s.id} className="mist-nav-group" data-closed={closed[s.id] || undefined}>
            <button type="button" className="mist-nav-head" aria-expanded={!closed[s.id]} onClick={() => setClosed(c => ({ ...c, [s.id]: !c[s.id] }))}>{uiText(s.label)}<Icon icon={ChevronDown} size="xs" /></button>
            <div className="mist-nav-items"><div>
              {s.items.map(it => (
                <button key={it.id} type="button" className="mist-nav-item" aria-current={it.id === activeId ? 'page' : undefined} title={uiText(it.label)} onClick={() => { close(); onNavigate(it.id); }}>
                  <Icon icon={it.icon} /><span>{uiText(it.label)}</span>{it.count ? <span className="mist-nav-count">{it.count}</span> : null}
                </button>
              ))}
            </div></div>
          </div>
        ))}
      </nav>
      {assistant && <button type="button" className="mist-side-ai" onClick={within(assistant.onClick)}><div className="mist-side-ai-t"><AIBadge />{uiText(assistant.title)}</div><p>{uiText(assistant.text)}</p></button>}
      <button type="button" className="mist-me" aria-current={activeId === 'account' ? 'page' : undefined} onClick={within(account.onClick)}><Avatar name={account.name} src={account.avatarUrl} /><div><b>{account.name}</b>{account.caption && <small>{uiText(account.caption)}</small>}</div><Icon icon={ChevronRight} size="sm" /></button>
    </aside>
  );
}

/* ───────────── Topbar ───────────── */
export type Crumb = { label: React.ReactNode; onClick?: () => void; mono?: boolean; hideOnMobile?: boolean };
export function MistTopbar({ crumbs, scrolled, sync, theme, onToggleTheme, onSearch, notifications, onAsk, extra, onBack, backLabel = '返回' }: {
  crumbs: Crumb[]; scrolled?: boolean; sync?: { state?: 'ok' | 'syncing' | 'offline'; text: string };
  theme?: ThemeMode; onToggleTheme?: () => void; onSearch?: () => void; notifications?: { unread: boolean; onClick: () => void }; onAsk?: () => void; extra?: React.ReactNode;
  /** 二级页（详情、新建）返回上一页。手机端和独立窗口（PWA）没有浏览器返回键，顶栏常驻返回按钮。 */
  onBack?: () => void; backLabel?: string;
}) {
  const menu = React.useContext(MobileNavCtx);
  return (
    <header className="mist-topbar" data-scrolled={scrolled || undefined} data-has-back={onBack ? true : undefined}>
      {menu && <button type="button" className="mist-top-menu" aria-label={uiText("打开菜单")} title={uiText("菜单")} aria-controls="mist-side" aria-expanded={menu.open} onClick={() => menu.setOpen(true)}><MistMark className="mist-top-menu-mark" /><Icon icon={Menu} size="xs" /></button>}
      {onBack && <button type="button" className="mist-top-back" aria-label={uiText(backLabel)} title={uiText(backLabel)} onClick={onBack}><Icon icon={ArrowLeft} /></button>}
      <div className="mist-crumbs">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          const content = c.mono ? <span className="mist-mono">{uiText(c.label)}</span> : uiText(c.label);
          return <React.Fragment key={i}>
            {i > 0 && <span className="mist-crumb-sep" data-hide-sm={crumbs[i - 1].hideOnMobile || undefined}><Icon icon={ChevronRight} size="xs" /></span>}
            {last ? <b data-hide-sm={c.hideOnMobile || undefined} title={uiText(plainText(c.label) || undefined)}>{content}</b> : c.onClick ? <button type="button" onClick={c.onClick} data-hide-sm={c.hideOnMobile || undefined} title={uiText(plainText(c.label) || undefined)}>{content}</button> : <span data-hide-sm={c.hideOnMobile || undefined} title={uiText(plainText(c.label) || undefined)}>{content}</span>}
          </React.Fragment>;
        })}
      </div>
      <div className="mist-top-actions">
        {sync && <span className="mist-sync" data-state={sync.state && sync.state !== 'ok' ? sync.state : undefined}><i />{uiText(sync.text)}</span>}
        {extra}
        {onSearch && <IconButton icon={Search} label={uiText("搜索")} onClick={onSearch} />}
        {notifications && <IconButton icon={Bell} label={uiText("通知")} dot={notifications.unread} onClick={notifications.onClick} />}
        {onToggleTheme && <IconButton icon={theme === 'dark' ? Sun : Moon} label={uiText(theme === 'dark' ? '切换浅色' : '切换深色')} onClick={onToggleTheme} />}
        {onAsk && <button type="button" className="mist-ask" aria-label={uiText("问小竹")} onClick={onAsk}><AIBadge /><span>{uiText("问小竹")}</span></button>}
      </div>
    </header>
  );
}

/* ───────────── AppShell ───────────── */
/**
 * 整站外壳：侧栏 + 圆角画布（顶栏 + 滚动区）。
 * children 放 <MistPage>。scrollKey 变化时滚动回顶部（切换页面时传 view id）。
 */
export function MistAppShell({ sidebar, topbar, collapsed, children, scrollKey }: { sidebar: React.ReactNode; topbar: (scrolled: boolean) => React.ReactNode; collapsed?: boolean; children: React.ReactNode; scrollKey?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [footerTarget, setFooterTarget] = React.useState<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!footerTarget) return;
    const measure = () => setFooterHeight(Math.ceil(footerTarget.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(footerTarget);
    return () => observer.disconnect();
  }, [footerTarget]);
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => { ref.current?.scrollTo?.({ top: 0 }); if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches) window.scrollTo?.({ top: 0 }); setScrolled(false); }, [scrollKey]);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menu = React.useMemo(() => ({ open: menuOpen, setOpen: setMenuOpen }), [menuOpen]);
  React.useEffect(() => { setMenuOpen(false); }, [scrollKey]);
  // 手机端由文档本身滚动（.mist-scroll 不再是滚动容器），顶栏分隔线按窗口滚动判断。
  React.useEffect(() => {
    const mobile = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
    const h = () => { if (mobile()) setScrolled(window.scrollY > 4); };
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  // 手机：从屏幕左边缘向右滑打开导航，在打开的导航上向左滑关闭。
  const swipe = React.useRef<{ x: number; y: number; edge: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; swipe.current = t ? { x: t.clientX, y: t.clientY, edge: t.clientX <= 24 } : null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipe.current, t = e.changedTouches[0]; swipe.current = null;
    if (!start || !t || typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 760px)').matches) return;
    const dx = t.clientX - start.x, dy = Math.abs(t.clientY - start.y);
    if (dy > Math.abs(dx)) return;
    if (!menuOpen && start.edge && dx > 60) setMenuOpen(true);
    else if (menuOpen && dx < -60) setMenuOpen(false);
  };
  return (
    <MobileNavCtx.Provider value={menu}>
      <FormFooterTargetContext.Provider value={footerTarget}>
      <div className="mist-app" data-collapsed={collapsed || undefined} data-menu-open={menuOpen || undefined} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {sidebar}
        <main className="mist-canvas" style={{ '--mist-form-footer-height': `${footerHeight}px` } as React.CSSProperties}>
          {topbar(scrolled)}
          <div className="mist-scroll" ref={ref} onScroll={e => setScrolled((e.target as HTMLDivElement).scrollTop > 4)}>{uiText(children)}</div>
          <div className="mist-form-dock" ref={setFooterTarget} />
        </main>
      </div>
      </FormFooterTargetContext.Provider>
    </MobileNavCtx.Provider>
  );
}

/** 页面容器：最大宽 1240，入场动画。width='narrow' 用于表单/设置，'wide' 用于看板。 */
export function MistPage({ children, width }: { children: React.ReactNode; width?: 'narrow' | 'wide' }) {
  return <FormFooterWidthContext.Provider value={width}><div className="mist-page" data-width={width}>{uiText(children)}</div></FormFooterWidthContext.Provider>;
}

/** 页头：eyebrow（所属分组）+ 标题 + 一句话说明 + 右侧操作（最多 1 个 primary）。 */
export function PageHeader({ eyebrow, title, description, actions, variant }: { eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; variant?: 'greeting' }) {
  return (
    <section className="mist-page-head" data-variant={variant}>
      <div className="mist-page-head-lead">{eyebrow && <span className="mist-eyebrow">{eyebrow}</span>}<h1 className="mist-h1">{uiText(title)}</h1>{description && <p className="mist-sub">{uiText(description)}</p>}</div>
      {actions && <div className="mist-page-head-acts">{actions}</div>}
    </section>
  );
}
export function BackLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className="mist-back" onClick={onClick}><Icon icon={ArrowLeft} size="sm" />{uiText(children)}</button>;
}
export function Toolbar({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  return <div className="mist-toolbar">{uiText(children)}{right && <div className="mist-toolbar-right">{right}</div>}</div>;
}

/** 启动画面（应用首次加载）。 */
export function MistSplash({ visible }: { visible: boolean }) {
  const [gone, setGone] = React.useState(false);
  React.useEffect(() => { if (!visible) { const t = window.setTimeout(() => setGone(true), 700); return () => window.clearTimeout(t); } }, [visible]);
  if (gone) return null;
  return <div className="mist-splash" data-out={!visible || undefined}><div className="mist-splash-id"><MistMark /><MistWordmark /></div></div>;
}
