/* Handwriting technique adapted from Bencho Signature (MIT, Lorenzo Cabra, bencho.dev/blocks/signature):
 * velocity-weighted ink width, smoothed pen lag and a reverse un-draw on clear. Mist styling, labels
 * and the SVG export below are Bambook's own. */
import React from 'react';
import { uiText } from '../../services/interfaceLanguage';

const W = 480, H = 168, LINE_Y = 124, INSET = 32;
type Pt = { x: number; y: number; w: number };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const THIN = 1.2, THICK = 4.2;

/** Each stroke as quadratic pieces through the midpoints, every piece as wide as the pen was there. */
function segments(stroke: Pt[], upto: number): Array<{ d: string; w: number } | { dot: Pt }> {
  const n = Math.min(stroke.length, upto);
  if (n <= 0) return [];
  if (stroke.length === 1) return [{ dot: stroke[0] }];
  const out: Array<{ d: string; w: number }> = [];
  for (let i = 1; i < n; i++) {
    const a = stroke[i - 1], b = stroke[i];
    const start = i === 1 ? a : { x: (stroke[i - 2].x + a.x) / 2, y: (stroke[i - 2].y + a.y) / 2 };
    const end = i === stroke.length - 1 ? b : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    out.push({ d: `M${start.x.toFixed(1)} ${start.y.toFixed(1)}Q${a.x.toFixed(1)} ${a.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`, w: (a.w + b.w) / 2 });
  }
  return out;
}

/** Standalone SVG of the strokes in solid ink, cropped to the written area, for archiving with a decision. */
// Archived SVG must keep solid ink on white PDFs regardless of the UI theme.
const ARCHIVE_INK = '#0E1A21'; // mist-allow: 存档 SVG 需实色
/** Upper bound on recorded points; past it further movement is ignored (a real signature stays far below). */
export const SIGNATURE_MAX_POINTS = 4000;
export function signatureSvg(strokes: Pt[][], ink = ARCHIVE_INK): string {
  const points = strokes.flat();
  if (!points.length) return '';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = 8, minX = Math.max(0, x0 - pad), minY = Math.max(0, y0 - pad), maxX = Math.min(W, x1 + pad), maxY = Math.min(H, y1 + pad);
  const body = strokes.flatMap(s => segments(s, s.length).map(seg => 'dot' in seg
    ? `<circle cx="${seg.dot.x.toFixed(1)}" cy="${seg.dot.y.toFixed(1)}" r="${(seg.dot.w / 2).toFixed(2)}" fill="${ink}"/>`
    : `<path d="${seg.d}" stroke-width="${seg.w.toFixed(2)}"/>`)).join('');
  const vw = (maxX - minX).toFixed(1), vh = (maxY - minY).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${vw} ${vh}" width="${vw}" height="${vh}" fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export type SignatureValue = { svg: string; strokes: number; points: number };

/**
 * 手写签字板：笔速越快线越细、停顿处墨迹变粗；“重签”按落笔的反序把笔迹收回。
 * onChange 在每一笔结束后给出可存档的 SVG；清空后给 null。
 */
export function SignaturePad({ onChange, disabled, ariaLabel = '手写签字' }: { onChange: (value: SignatureValue | null) => void; disabled?: boolean; ariaLabel?: string }) {
  const pad = React.useRef<HTMLDivElement>(null);
  const strokes = React.useRef<Pt[][]>([]);
  const [, setVersion] = React.useState(0);
  const [cut, setCut] = React.useState<number | null>(null);
  const down = React.useRef(false), last = React.useRef({ x: 0, y: 0, t: 0, w: 0 }), raf = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const redraw = () => setVersion(v => v + 1);
  const total = strokes.current.reduce((n, s) => n + s.length, 0), rewinding = cut !== null, inked = total > 0;
  const emit = () => { const points = strokes.current.reduce((n, s) => n + s.length, 0); onChange(points ? { svg: signatureSvg(strokes.current), strokes: strokes.current.length, points } : null); };
  // A pad with no measured size (hidden pane, drawer mid-animation) yields no point rather than NaN ink.
  const local = (e: React.PointerEvent) => { const r = pad.current!.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return null; const x = ((e.clientX - r.left) * W) / r.width, y = ((e.clientY - r.top) * H) / r.height; return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp(x, 0, W), y: clamp(y, 0, H) } : null; };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || rewinding || e.button > 0 || strokes.current.reduce((n, s) => n + s.length, 0) >= SIGNATURE_MAX_POINTS) return;
    const p = local(e), w = (THIN + THICK) / 2;
    if (!p) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    down.current = true;
    last.current = { ...p, t: performance.now(), w };
    strokes.current.push([{ ...p, w }]);
    redraw();
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!down.current || strokes.current.reduce((n, s) => n + s.length, 0) >= SIGNATURE_MAX_POINTS) return;
    const raw = local(e), l = last.current;
    if (!raw) return;
    const x = l.x + (raw.x - l.x) * 0.62, y = l.y + (raw.y - l.y) * 0.62, d = Math.hypot(x - l.x, y - l.y);
    if (d < 0.8) return;
    const t = performance.now(), v = d / Math.max(1, t - l.t);
    const w = l.w + ((THICK - (THICK - THIN) * clamp(v / 1.6, 0, 1)) - l.w) * 0.35;
    last.current = { x, y, t, w };
    strokes.current[strokes.current.length - 1].push({ x, y, w });
    redraw();
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
    if (!down.current) return;
    down.current = false;
    emit();
  };
  const clear = () => {
    if (!inked || rewinding) return;
    const n = total, dur = clamp(n * 5, 320, 1800), t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setCut(Math.round(n * (1 - ease(k))));
      if (k < 1) { raf.current = requestAnimationFrame(step); return; }
      // strokes live in a ref: force a render even when cut was already null (a one-frame rewind).
      strokes.current = []; setCut(null); redraw(); onChange(null);
    };
    raf.current = requestAnimationFrame(step);
  };
  let left = cut ?? Infinity;
  const ink: React.ReactNode[] = [];
  strokes.current.forEach((s, i) => {
    if (left <= 0) return;
    segments(s, left).forEach((seg, j) => ink.push('dot' in seg
      ? <circle key={`${i}-${j}`} cx={seg.dot.x} cy={seg.dot.y} r={seg.dot.w / 2} fill="currentColor" />
      : <path key={`${i}-${j}`} d={seg.d} strokeWidth={seg.w.toFixed(2)} />));
    left -= s.length;
  });
  return (
    <div className="mist-signature" data-inked={inked || undefined} data-disabled={disabled || undefined}>
      <div
        ref={pad}
        className="mist-signature-pad"
        role="img"
        aria-label={uiText(inked ? ariaLabel + '：已签' : ariaLabel + '：未签')}
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={e => e.preventDefault()}
        // The pad usually sits inside a <label> (Field). A stroke ends with a click that the label would
        // forward to its first labelable control — the 重签 button — wiping the signature.
        onClick={e => e.preventDefault()}
      >
        <span className="mist-signature-line" style={{ top: `${(LINE_Y / H) * 100}%`, left: `${(INSET / W) * 100}%`, right: `${(INSET / W) * 100}%` }} aria-hidden="true" />
        {!inked && <span className="mist-signature-hint" aria-hidden="true">{uiText('在此签名')}</span>}
        <svg className="mist-signature-ink" viewBox={`0 0 ${W} ${H}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ink}</svg>
      </div>
      <button type="button" className="mist-signature-clear" disabled={!inked || rewinding || disabled} onClick={clear}>{uiText('重签')}</button>
    </div>
  );
}
