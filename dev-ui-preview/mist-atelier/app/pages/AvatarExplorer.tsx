import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Check, MousePointer2 } from 'lucide-react';
import { Banner, Icon } from '../../../../components/mist';
import { interfaceLocale, uiText } from '../../../../services/interfaceLanguage';
import { avatarDirections, exploreAvatarAt } from '../../../../lib/avatarExploration';
import { ANIMATED_AVATAR_FAMILIES, AVATAR_COLORS, avatarIdentity, type AvatarColor } from '../../../../lib/avatarIdentity';
const GUIDE = ['找到，属于你的样子', '按住头像，让颜色流转', '保持按住，拖动探索不同风格', '松开，留下喜欢的这一刻'];
const randomSeed = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
/** 只接受本地生成器产出的 SVG：持久 SVG 树换色只改属性，换形状 220ms 淡入淡出。 */
export function AvatarLivePreview({ src, geometryKey }: { src: string; geometryKey: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  const mounted = React.useRef<{ key: string; svg: SVGSVGElement } | null>(null);
  const departing = React.useRef<{ svg: SVGSVGElement; animation: Animation } | null>(null);
  React.useEffect(() => () => { departing.current?.animation.cancel(); departing.current?.svg.remove(); }, []);
  React.useLayoutEffect(() => {
    const el = host.current;
    if (!el || !src.startsWith('data:image/svg+xml;charset=utf-8,') || typeof el.attachShadow !== 'function') return;
    const parsed = new DOMParser().parseFromString(decodeURIComponent(src.slice(src.indexOf(',') + 1)), 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') return;
    const incoming = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    const root = el.shadowRoot || el.attachShadow({ mode: 'open' });
    if (!root.querySelector('style')) {
      const style = document.createElement('style');
      style.textContent = ':host{display:grid;width:100%;height:100%;border-radius:50%;overflow:hidden}svg{display:block;width:100%;height:100%;grid-area:1/1}svg [fill],svg [stroke],svg stop{transition:fill .16s,stroke .16s,stop-color .16s}@media(prefers-reduced-motion:reduce){svg *{transition:none!important}}';
      root.append(style);
    }
    const previous = mounted.current;
    if (!previous || previous.key !== geometryKey) {
      departing.current?.animation.cancel(); departing.current?.svg.remove(); departing.current = null;
      root.append(incoming);
      mounted.current = { key: geometryKey, svg: incoming };
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (previous && !reduce && typeof incoming.animate === 'function') {
        const timing = { duration: 220, easing: 'cubic-bezier(.22,.61,.36,1)' };
        const outgoing = previous.svg.animate([{ opacity: 1 }, { opacity: 0 }], timing);
        departing.current = { svg: previous.svg, animation: outgoing };
        outgoing.onfinish = () => { previous.svg.remove(); if (departing.current?.svg === previous.svg) departing.current = null; };
        incoming.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      } else previous?.svg.remove();
      return;
    }
    // 同一形状种子结构一致，换色只更新属性，不打断原生动画。
    const current = [previous.svg, ...previous.svg.querySelectorAll('*')], next = [incoming, ...incoming.querySelectorAll('*')];
    if (current.length !== next.length || current.some((node, i) => node.localName !== next[i].localName)) {
      previous.svg.replaceWith(incoming); mounted.current = { key: geometryKey, svg: incoming }; return;
    }
    current.forEach((node, i) => {
      const target = next[i];
      for (const a of Array.from(node.attributes)) if (!target.hasAttributeNS(a.namespaceURI, a.localName)) node.removeAttributeNS(a.namespaceURI, a.localName);
      for (const a of Array.from(target.attributes)) if (node.getAttributeNS(a.namespaceURI, a.localName) !== a.value) node.setAttributeNS(a.namespaceURI, a.name, a.value);
      if (!node.children.length && node.textContent !== target.textContent) node.textContent = target.textContent;
    });
  }, [src, geometryKey]);
  return <div ref={host} className="mist-avatar-live" role="img" aria-label={uiText("头像预览")} />;
}

type Preset = { src: string; identity: string };
/** 探索器：位置决定风格族，按住时间决定色相；松开后颜色落到最近的 Mist 色系。 */
export function AvatarExplorer({ value, disabled, active=true, palette, onPaletteChange, onSelect }: { value?: string | null; disabled: boolean; active?:boolean; palette:AvatarColor; onPaletteChange:(color:AvatarColor)=>void; onSelect: (identity: string) => void }) {
  const reduced = useReducedMotion();
  const [showGuide, setShowGuide] = React.useState(true), [guideStep, setGuideStep] = React.useState(0);
  React.useEffect(() => {
    if (!active || !showGuide || guideStep >= 3) return;
    const timer = window.setTimeout(() => setGuideStep(step => step + 1), guideStep === 0 ? 2400 : 2000);
    return () => window.clearTimeout(timer);
  }, [active, showGuide, guideStep]);
  const paletteRef=React.useRef(palette);paletteRef.current=palette;
  const changeRef=React.useRef(onPaletteChange);changeRef.current=onPaletteChange;
  const [point, setPoint] = React.useState({ x: 0, y: 0 });
  const lastPointer = React.useRef({ x: NaN, y: NaN });
  const gesture = React.useRef<{ id:number|'keyboard'; index:number; last:number; started:number } | null>(null);
  const frame = React.useRef(0);
  const [held, setHeld] = React.useState(false);
  const stopColor=React.useCallback(()=>{
    if(!gesture.current)return;
    gesture.current=null;window.cancelAnimationFrame(frame.current);setHeld(false);
  },[]);
  const startColor=(id:number|'keyboard')=>{
    if(disabled||!active||gesture.current)return;
    const index=Math.max(0,AVATAR_COLORS.findIndex(color=>color.id===paletteRef.current));
    gesture.current={id,index,last:index,started:performance.now()};setHeld(true);
    const tick=(now:number)=>{
      const current=gesture.current;if(!current)return;
      const next=(current.index+Math.floor((now-current.started)/500))%AVATAR_COLORS.length;
      if(next!==current.last){current.last=next;changeRef.current(AVATAR_COLORS[next].id);}
      frame.current=window.requestAnimationFrame(tick);
    };
    frame.current=window.requestAnimationFrame(tick);
  };
  React.useEffect(()=>{
    const onVisibility=()=>{if(document.hidden)stopColor();};
    window.addEventListener('blur',stopColor);document.addEventListener('visibilitychange',onVisibility);
    return()=>{gesture.current=null;window.cancelAnimationFrame(frame.current);window.removeEventListener('blur',stopColor);document.removeEventListener('visibilitychange',onVisibility);};
  },[stopColor]);
  React.useEffect(()=>{if(disabled||!active)stopColor();},[active,disabled,stopColor]);
  const [seed, setSeed] = React.useState(randomSeed);
  const [preset, setPreset] = React.useState<Preset | null>(null), [error, setError] = React.useState(false), [readyKey, setReadyKey] = React.useState('');
  const cellX = Math.round(point.x * 12), cellY = Math.round(point.y * 12);
  const result = React.useMemo(() => exploreAvatarAt(point.x, point.y), [point, interfaceLocale()]);
  const shapeKey = `${result.family}:${seed}:${cellX + 12}_${cellY + 12}`, key = `${palette}:${shapeKey}`;
  const generating = readyKey !== key;
  const latest = React.useRef({ family: result.family, palette, cellX, cellY, seed, key, shapeKey });
  latest.current = { family: result.family, palette, cellX, cellY, seed, key, shapeKey };
  React.useEffect(() => {
    if(!active)return;
    let live = true, raf = 0, processedKey = '', processedShape = '', last = -Infinity;
    import('../../../../lib/avatarPresets').then(({ generateAvatar }) => {
      if (!live) return;
      // 持续采样最新位置；移动不重置节拍，同形换色更快。
      const tick = (now: number) => {
        if (!live) return;
        const job = latest.current, interval = job.shapeKey === processedShape ? 24 : 80;
        if (!document.hidden && job.key !== processedKey && now - last >= interval) {
          try {
            const id = `p${job.palette}_v13_${job.cellX + 12}_${job.cellY + 12}_${job.seed}-0`;
            const animated = ANIMATED_AVATAR_FAMILIES.has(job.family);
            setPreset({ src: generateAvatar(job.family, id, animated), identity: avatarIdentity(job.family, id, animated) });
            setError(false); processedShape = job.shapeKey;
          } catch { setError(true); }
          processedKey = job.key; last = now; setReadyKey(job.key);
        }
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; window.cancelAnimationFrame(raf); };
  }, [active]);
  const update = (x: number, y: number) => {
    const length = Math.max(1, Math.hypot(x, y));
    setSeed(randomSeed()); setPoint({ x: x / length, y: y / length });
  };
  const locate = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointer.current = { x: event.clientX, y: event.clientY };
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    update((event.clientX - rect.left - rect.width / 2) / (rect.width * .5), (event.clientY - rect.top - rect.height / 2) / (rect.height * .5));
  };
  const release = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    stopColor();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const applied = !!preset && preset.identity === value;
  return <div className="mist-avatar-explorer" aria-label={uiText("探索头像风格")}>
    <div className="mist-avatar-stage">
      {avatarDirections.map(direction => {
        const proximity = Math.max(0, 1 - Math.hypot(point.x - direction.x, point.y - direction.y));
        const eased = proximity ** 3 * (proximity * (proximity * 6 - 15) + 10);
        return <button type="button" key={direction.label} className="mist-avatar-direction" disabled={disabled}
          aria-pressed={result.radius >= .25 && (direction.x ? point.x * direction.x : point.y * direction.y) > .65}
          style={{ left: `calc(50% + ${direction.x} * (var(--avatar-size) / 2 + 48px))`, top: `calc(50% + ${direction.y} * (var(--avatar-size) / 2 + 40px))` }}
          onClick={() => { setShowGuide(false); update(direction.x, direction.y); }}>
          <motion.span animate={{ scale: 1 + eased * .6 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 22, mass: .9 }}>{uiText(direction.label)}</motion.span>
        </button>;
      })}
      <div className="mist-avatar-compass" style={{backgroundColor:AVATAR_COLORS.find(color=>color.id===palette)!.value}} role="group" aria-label={uiText("头像探索")} tabIndex={disabled ? -1 : 0} data-held={held || undefined}
        aria-busy={generating} aria-disabled={disabled} aria-describedby="mist-avatar-mood"
        onPointerDown={e => { if (!disabled && e.button === 0 && !gesture.current) { setShowGuide(false); e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); locate(e); startColor(e.pointerId); } }}
        onPointerMove={e => { if (!disabled && gesture.current?.id === e.pointerId) { if (e.pointerType === 'mouse' && !(e.buttons & 1)) release(e); else if (e.clientX !== lastPointer.current.x || e.clientY !== lastPointer.current.y) locate(e); } }}
        onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={stopColor}
        onKeyUp={e => { if ((e.key === ' ' || e.key === 'Enter') && gesture.current?.id === 'keyboard') { e.preventDefault(); stopColor(); } }}
        onKeyDown={e => {
          setShowGuide(false);
          if (disabled) return;
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startColor('keyboard'); return; }
          const delta: Record<string, [number, number]> = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.15], ArrowDown: [0, .15] };
          if (delta[e.key]) { e.preventDefault(); update(point.x + delta[e.key][0], point.y + delta[e.key][1]); }
          if (e.key === 'Home') { e.preventDefault(); update(0, 0); }
        }}>
        {preset ? <AvatarLivePreview src={preset.src} geometryKey={preset.identity.replace(/:p[a-z]+_v13_/, ':v13_')} /> : <span className="mist-note">{uiText(error ? '生成失败' : '正在寻找灵感…')}</span>}
      </div>
      <AnimatePresence>{active && showGuide && <motion.div key="pointer" className="mist-avatar-guide-pointer" aria-hidden="true" exit={{ opacity: 0 }}
        animate={reduced ? {} : { x: [0, 0, -45, 40, 0, 0], y: [0, 0, -25, 25, 0, 0], scale: [1, .84, .84, .84, 1, 1] }}
        transition={{ delay: 2.4, duration: 6, times: [0, .3, .45, .6, .72, 1], ease: 'easeInOut' }}>
        <MousePointer2 size={22} strokeWidth={1.25} />
      </motion.div>}</AnimatePresence>
    </div>
    <div className="mist-avatar-explorer-palette" role="group" aria-label={uiText('图案颜色')}>
      {AVATAR_COLORS.map(color=><button key={color.id} type="button" disabled={disabled} data-color={color.id} aria-label={uiText(`图案颜色 · ${color.label}`)} aria-pressed={palette===color.id} title={uiText(color.label)} style={{backgroundColor:color.value}} onClick={()=>{setShowGuide(false);onPaletteChange(color.id);}}>{palette===color.id&&<Icon icon={Check} size="xs"/>}</button>)}
    </div>
    <div id="mist-avatar-mood" className="mist-sr-only" aria-live="polite">{uiText(result.label === '自由探索' ? result.label : `${result.label}倾向`)}</div>
    <div className="mist-avatar-explore-foot">
      <AnimatePresence mode="wait" initial={false}>{showGuide
        ? <motion.div key="guide" className="mist-avatar-guide" exit={{ opacity: 0 }} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.span key={guideStep} data-welcome={guideStep === 0 || undefined} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>{GUIDE[guideStep]}</motion.span>
          <div className="mist-avatar-guide-progress" aria-hidden="true">{[0, 1, 2].map(step => <i key={step} data-active={step === guideStep - 1 || undefined} />)}</div>
          <button type="button" className="mist-avatar-link" onClick={() => setShowGuide(false)}>{uiText("开始探索 ↗")}</button>
        </motion.div>
        : !held && <motion.div key="apply" exit={{ opacity: 0 }} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <button type="button" className="mist-avatar-link" data-size="lg" disabled={disabled || generating || error || !preset || applied}
            onClick={() => preset && onSelect(preset.identity)}>{uiText(disabled ? '应用中…' : applied ? '已使用' : '就用这个')}<ArrowUpRight size={18} strokeWidth={1.25} /></button>
        </motion.div>}</AnimatePresence>
    </div>
    {error && <Banner tone="bad" title={uiText("头像生成失败")}>{uiText("请关闭后重新打开头像编辑。")}</Banner>}
  </div>;
}

