/** 头像自定义：按住头像让颜色在 8 套 Mist 色相间流转、拖动按方向探索 DiceBear 风格；也可上传照片裁剪，或恢复姓名首字。 */
import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, ImageUp, MousePointer2, RotateCw, Undo2 } from 'lucide-react';
import { Avatar, Banner, Button, Dialog, useToast } from '../../../../components/mist';
import { updateMyProfile } from '../../../../services/authService';
import { avatarDirections, exploreAvatarAt } from '../../../../lib/avatarExploration';
import { ANIMATED_AVATAR_FAMILIES, avatarIdentity, parseAvatarIdentity } from '../../../../lib/avatarIdentity';
import { closestMistScheme, mistSchemeHues } from '../../../../lib/avatarColor';
import { useMistSession } from '../runtime/auth';

const MAX_AVATAR_CHARS = 700_000;
const CROP_PREVIEW = 224, CROP_OUTPUT = 256;
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
  return <div ref={host} className="mist-avatar-live" role="img" aria-label="头像预览" />;
}

type Preset = { src: string; identity: string };
/** 探索器：位置决定风格族，按住时间决定色相；松开后颜色落到最近的 Mist 色系。 */
export function AvatarExplorer({ value, disabled, onSelect }: { value?: string | null; disabled: boolean; onSelect: (identity: string) => void }) {
  const reduced = useReducedMotion();
  const [showGuide, setShowGuide] = React.useState(true), [guideStep, setGuideStep] = React.useState(0);
  React.useEffect(() => {
    if (!showGuide || guideStep >= 3) return;
    const timer = window.setTimeout(() => setGuideStep(step => step + 1), guideStep === 0 ? 2400 : 2000);
    return () => window.clearTimeout(timer);
  }, [showGuide, guideStep]);
  const [hue, setHue] = React.useState(() => {
    const saved = parseAvatarIdentity(value)?.seed.match(/^c(\d{1,3})_v[56]_/);
    return saved ? Number(saved[1]) % 360 : mistSchemeHues[4];
  });
  const hueRef = React.useRef(hue); hueRef.current = hue;
  const [point, setPoint] = React.useState({ x: 0, y: 0 });
  const lastPointer = React.useRef({ x: NaN, y: NaN });
  const gesture = React.useRef<{ id: number | 'keyboard'; scheme: number; hue: number; started: number } | null>(null);
  const frame = React.useRef(0);
  const [held, setHeld] = React.useState(false);
  const stopColor = React.useCallback(() => {
    if (!gesture.current) return;
    gesture.current = null;
    window.cancelAnimationFrame(frame.current);
    const settled = mistSchemeHues[closestMistScheme(hueRef.current)];
    hueRef.current = settled; setHue(settled); setHeld(false);
  }, []);
  const startColor = (id: number | 'keyboard') => {
    if (disabled || gesture.current) return;
    gesture.current = { id, scheme: closestMistScheme(hueRef.current), hue: hueRef.current, started: performance.now() };
    setHeld(true);
    const tick = (now: number) => {
      const g = gesture.current;
      if (!g) return;
      const progress = (now - g.started) / 500, step = Math.floor(progress);
      const from = step === 0 ? g.hue : mistSchemeHues[(g.scheme + step) % mistSchemeHues.length];
      const to = mistSchemeHues[(g.scheme + step + 1) % mistSchemeHues.length];
      const distance = ((to - from + 540) % 360) - 180;
      const next = Math.round((from + distance * (progress - step) + 360) % 360) % 360;
      if (next !== hueRef.current) { hueRef.current = next; setHue(next); }
      frame.current = window.requestAnimationFrame(tick);
    };
    frame.current = window.requestAnimationFrame(tick);
  };
  React.useEffect(() => {
    const onVisibility = () => { if (document.hidden) stopColor(); };
    window.addEventListener('blur', stopColor); document.addEventListener('visibilitychange', onVisibility);
    return () => { gesture.current = null; window.cancelAnimationFrame(frame.current); window.removeEventListener('blur', stopColor); document.removeEventListener('visibilitychange', onVisibility); };
  }, [stopColor]);
  React.useEffect(() => { if (disabled) stopColor(); }, [disabled, stopColor]);
  const [seed, setSeed] = React.useState(randomSeed);
  const [preset, setPreset] = React.useState<Preset | null>(null), [error, setError] = React.useState(false), [readyKey, setReadyKey] = React.useState('');
  const cellX = Math.round(point.x * 12), cellY = Math.round(point.y * 12);
  const result = React.useMemo(() => exploreAvatarAt(point.x, point.y), [point]);
  const shapeKey = `${result.family}:${seed}:${cellX + 12}_${cellY + 12}`, key = `${hue}:${shapeKey}`;
  const generating = readyKey !== key;
  const latest = React.useRef({ family: result.family, hue, cellX, cellY, seed, key, shapeKey });
  latest.current = { family: result.family, hue, cellX, cellY, seed, key, shapeKey };
  React.useEffect(() => {
    let active = true, raf = 0, processedKey = '', processedShape = '', last = -Infinity;
    import('../../../../lib/avatarPresets').then(({ generateAvatar }) => {
      if (!active) return;
      // 持续采样最新位置；移动不重置节拍，同形换色更快。
      const tick = (now: number) => {
        if (!active) return;
        const job = latest.current, interval = job.shapeKey === processedShape ? 24 : 80;
        if (!document.hidden && job.key !== processedKey && now - last >= interval) {
          try {
            const id = `c${job.hue}_v6_${job.cellX + 12}_${job.cellY + 12}_${job.seed}-0`;
            const animated = ANIMATED_AVATAR_FAMILIES.has(job.family);
            setPreset({ src: generateAvatar(job.family, id, animated), identity: avatarIdentity(job.family, id, animated) });
            setError(false); processedShape = job.shapeKey;
          } catch { setError(true); }
          processedKey = job.key; last = now; setReadyKey(job.key);
        }
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; window.cancelAnimationFrame(raf); };
  }, []);
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
  return <div className="mist-avatar-explorer" aria-label="探索头像风格">
    <div className="mist-avatar-stage">
      {avatarDirections.map(direction => {
        const proximity = Math.max(0, 1 - Math.hypot(point.x - direction.x, point.y - direction.y));
        const eased = proximity ** 3 * (proximity * (proximity * 6 - 15) + 10);
        return <button type="button" key={direction.label} className="mist-avatar-direction" disabled={disabled}
          aria-pressed={result.radius >= .25 && (direction.x ? point.x * direction.x : point.y * direction.y) > .65}
          style={{ left: `calc(50% + ${direction.x} * (var(--avatar-size) / 2 + 48px))`, top: `calc(50% + ${direction.y} * (var(--avatar-size) / 2 + 40px))` }}
          onClick={() => { setShowGuide(false); update(direction.x, direction.y); }}>
          <motion.span animate={{ scale: 1 + eased * .6 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 22, mass: .9 }}>{direction.label}</motion.span>
        </button>;
      })}
      <div className="mist-avatar-compass" role="group" aria-label="头像探索" tabIndex={disabled ? -1 : 0} data-held={held || undefined}
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
        {preset ? <AvatarLivePreview src={preset.src} geometryKey={preset.identity.replace(/:c\d+_v/, ':v')} /> : <span className="mist-note">{error ? '生成失败' : '正在寻找灵感…'}</span>}
      </div>
      <AnimatePresence>{showGuide && <motion.div key="pointer" className="mist-avatar-guide-pointer" aria-hidden="true" exit={{ opacity: 0 }}
        animate={reduced ? {} : { x: [0, 0, -45, 40, 0, 0], y: [0, 0, -25, 25, 0, 0], scale: [1, .84, .84, .84, 1, 1] }}
        transition={{ delay: 2.4, duration: 6, times: [0, .3, .45, .6, .72, 1], ease: 'easeInOut' }}>
        <MousePointer2 size={22} strokeWidth={1.25} />
      </motion.div>}</AnimatePresence>
    </div>
    <div id="mist-avatar-mood" className="mist-sr-only" aria-live="polite">{result.label === '自由探索' ? result.label : `${result.label}倾向`}</div>
    <div className="mist-avatar-explore-foot">
      <AnimatePresence mode="wait" initial={false}>{showGuide
        ? <motion.div key="guide" className="mist-avatar-guide" exit={{ opacity: 0 }} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.span key={guideStep} data-welcome={guideStep === 0 || undefined} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>{GUIDE[guideStep]}</motion.span>
          <div className="mist-avatar-guide-progress" aria-hidden="true">{[0, 1, 2].map(step => <i key={step} data-active={step === guideStep - 1 || undefined} />)}</div>
          <button type="button" className="mist-avatar-link" onClick={() => setShowGuide(false)}>开始探索 ↗</button>
        </motion.div>
        : !held && <motion.div key="apply" exit={{ opacity: 0 }} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <button type="button" className="mist-avatar-link" data-size="lg" disabled={disabled || generating || error || !preset || applied}
            onClick={() => preset && onSelect(preset.identity)}>{disabled ? '应用中…' : applied ? '已使用' : '就用这个'}<ArrowUpRight size={18} strokeWidth={1.25} /></button>
        </motion.div>}</AnimatePresence>
    </div>
    {error && <Banner tone="bad" title="头像生成失败">请关闭后重新打开头像编辑。</Banner>}
  </div>;
}

type CropDraft = { src: string; width: number; height: number; scale: number; rotation: number; offset: { x: number; y: number } };
const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new window.Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片格式无法识别')); img.src = src; });
const readFile = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('读取头像失败')); reader.onload = () => resolve(String(reader.result || '')); reader.readAsDataURL(file); });
function rotatedSize(d: CropDraft) { return d.rotation % 180 === 0 ? [d.width, d.height] : [d.height, d.width]; }
/** 输出 256px 圆形 webp；偏移量按预览尺寸换算。 */
export async function renderCircularAvatar(d: CropDraft): Promise<string> {
  const img = await loadImage(d.src);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = CROP_OUTPUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持头像裁切');
  const [rw, rh] = rotatedSize(d), base = CROP_OUTPUT / Math.min(rw, rh), k = CROP_OUTPUT / CROP_PREVIEW;
  ctx.beginPath(); ctx.arc(CROP_OUTPUT / 2, CROP_OUTPUT / 2, CROP_OUTPUT / 2, 0, Math.PI * 2); ctx.clip();
  ctx.translate(CROP_OUTPUT / 2 + d.offset.x * k, CROP_OUTPUT / 2 + d.offset.y * k);
  ctx.rotate(d.rotation * Math.PI / 180);
  ctx.drawImage(img, -d.width * base * d.scale / 2, -d.height * base * d.scale / 2, d.width * base * d.scale, d.height * base * d.scale);
  return canvas.toDataURL('image/webp', .86);
}

function explain(e: unknown, fallback: string) { const text = e instanceof Error ? e.message : ''; return text && !/HTTP|failed/i.test(text) ? text : fallback; }

/** 头像编辑对话框：生成风格头像 / 上传照片 / 恢复姓名首字。保存走 PATCH /auth/me。 */
export function AvatarStudio({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useMistSession(), toast = useToast();
  const user = session.user;
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [crop, setCrop] = React.useState<CropDraft | null>(null);
  const drag = React.useRef<{ id: number; x: number; y: number; start: { x: number; y: number } } | null>(null);
  const file = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) setError(''); }, [open]);
  const save = async (avatarUrl: string | null, done: string) => {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      if (avatarUrl && avatarUrl.length > MAX_AVATAR_CHARS) throw new Error('头像图片太大，请缩小或换一张图片');
      await updateMyProfile({ avatarUrl });
      toast(done);
      return true;
    } catch (e) { setError(explain(e, '头像未更新，请重试')); return false; }
    finally { setBusy(false); }
  };
  const pick = async (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('请选择图片文件'); return; }
    setError('');
    try {
      const src = await readFile(f), img = await loadImage(src);
      setCrop({ src, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, scale: 1, rotation: 0, offset: { x: 0, y: 0 } });
    } catch (e) { setError(explain(e, '头像读取失败')); }
  };
  if (!user) return null;
  const name = user.displayName || user.email || '我';
  const [rw, rh] = crop ? rotatedSize(crop) : [1, 1], previewScale = CROP_PREVIEW / Math.min(rw, rh);
  return <>
    <Dialog open={open && !crop} onClose={() => !busy && onClose()} width={720} title="编辑头像" description="生成一个属于你的风格头像，或上传照片。头像会显示在侧栏、成员与审批记录中。"
      footer={<>
        <Button icon={ImageUp} disabled={busy} onClick={() => file.current?.click()}>上传照片</Button>
        {user.avatarUrl && <Button icon={Undo2} disabled={busy} onClick={() => void save(null, '已恢复姓名首字')}>恢复姓名首字</Button>}
        <span className="mist-spacer" />
        <span className="mist-row mist-note"><Avatar name={name} src={user.avatarUrl} size="sm" />当前头像</span>
      </>}>
      <input ref={file} type="file" accept="image/*" hidden aria-label="选择头像图片" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <Banner tone="bad" title="头像未更新">{error}</Banner>}
      {open && !crop && <AvatarExplorer value={user.avatarUrl} disabled={busy} onSelect={identity => void save(identity, '头像已更新')} />}
    </Dialog>
    <Dialog open={open && !!crop} onClose={() => !busy && setCrop(null)} title="调整头像" description="拖动照片调整位置，滑块缩放。"
      footer={<><Button disabled={busy} onClick={() => setCrop(null)}>返回</Button><span className="mist-spacer" /><Button variant="primary" loading={busy} onClick={async () => {
        if (!crop) return;
        let url = '';
        try { url = await renderCircularAvatar(crop); } catch (e) { setError(explain(e, '头像裁切失败')); return; }
        if (await save(url, '头像已更新')) { setCrop(null); onClose(); }
      }}>使用这张</Button></>}>
      {error && <Banner tone="bad" title="头像未更新">{error}</Banner>}
      {crop && <>
        <div className="mist-avatar-crop" style={{ width: CROP_PREVIEW, height: CROP_PREVIEW }}
          onPointerDown={e => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: crop.offset }; }}
          onPointerMove={e => { const d = drag.current; if (d && d.id === e.pointerId) setCrop({ ...crop, offset: { x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y } }); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <img src={crop.src} alt="待裁切的头像" draggable={false} style={{ width: crop.width * previewScale, height: crop.height * previewScale, transform: `translate(-50%, -50%) translate(${crop.offset.x}px, ${crop.offset.y}px) rotate(${crop.rotation}deg) scale(${crop.scale})` }} />
        </div>
        <div className="mist-row mist-avatar-crop-tools">
          <input type="range" aria-label="缩放" min={1} max={3} step={0.01} value={crop.scale} disabled={busy} onChange={e => setCrop({ ...crop, scale: Number(e.target.value) })} />
          <span className="mist-note mist-mono">{crop.scale.toFixed(2)}x</span>
          <Button size="sm" icon={RotateCw} disabled={busy} onClick={() => setCrop({ ...crop, rotation: (crop.rotation + 90) % 360 })}>旋转</Button>
          <Button size="sm" disabled={busy} onClick={() => setCrop({ ...crop, scale: 1, rotation: 0, offset: { x: 0, y: 0 } })}>重置</Button>
        </div>
      </>}
    </Dialog>
  </>;
}

/** 设置 · 账号里的头像行。 */
export function AvatarSettingRow() {
  const session = useMistSession(), [open, setOpen] = React.useState(false);
  const user = session.user;
  if (!user) return null;
  return <div className="mist-avatar-setting">
    <Avatar name={user.displayName || user.email} src={user.avatarUrl} size="xl" />
    <div><b>头像</b><p className="mist-note">{user.avatarUrl ? '已设置自定义头像' : '当前显示姓名首字'}</p></div>
    <span className="mist-spacer" />
    <Button size="sm" onClick={() => setOpen(true)}>编辑头像</Button>
    <AvatarStudio open={open} onClose={() => setOpen(false)} />
  </div>;
}
