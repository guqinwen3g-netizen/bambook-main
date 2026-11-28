import { uiText, ui } from '../../services/interfaceLanguage';
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronLeft, ChevronRight, Download, File as FileIcon, FileQuestion, FileSpreadsheet, FileText, FileVideo, Image as ImageIcon, Maximize, Minus, Music, Plus, RotateCw, X } from 'lucide-react';
import { Banner, Button, EmptyState, IconButton, Skeleton, Tile } from './primitives';
import { Portal, useModalFocus } from './overlays';
import { TextInput } from './form';

/* ═══════════════════════════════════════════════════════════════════
   附件在线预览：点击附件名称先预览，下载是旁边的独立动作。
   支持 图片 / PDF / Word(.docx) / Excel(.xlsx .xls .csv) / 纯文本 / 音视频；
   其它格式说明原因并提供下载。原件由调用方 load() 带登录凭据读取。
   ═══════════════════════════════════════════════════════════════════ */

export type PreviewFile = { id: string; name: string; mimeType?: string; size?: number };
export type PreviewKind = 'image' | 'pdf' | 'docx' | 'sheet' | 'text' | 'video' | 'audio' | 'unsupported';

const EXT: Record<string, PreviewKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image', ico: 'image',
  pdf: 'pdf', docx: 'docx', docm: 'docx', dotx: 'docx',
  xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet',
  txt: 'text', md: 'text', json: 'text', xml: 'text', log: 'text', yaml: 'text', yml: 'text', ini: 'text',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
};
const UNSUPPORTED_REASON: Record<string, string> = {
  doc: '旧版 Word（.doc）暂不支持在线预览。请下载后用 Word 打开，或另存为 .docx / PDF 后再上传。',
  ppt: 'PowerPoint 文件暂不支持在线预览，请下载后查看，或导出为 PDF 后再上传。',
  pptx: 'PowerPoint 文件暂不支持在线预览，请下载后查看，或导出为 PDF 后再上传。',
  rtf: 'RTF 文档暂不支持在线预览，请下载后查看。',
  heic: 'HEIC 照片暂不支持在浏览器中预览，请下载后查看，或在手机上设为“兼容性最佳”格式拍摄。',
  heif: 'HEIF 照片暂不支持在浏览器中预览，请下载后查看。',
  zip: '压缩包需要下载后解压查看。', rar: '压缩包需要下载后解压查看。', '7z': '压缩包需要下载后解压查看。',
  dwg: 'CAD 图纸暂不支持在线预览，请下载后用 CAD 软件查看。', ai: '设计源文件暂不支持在线预览，请下载后查看。', psd: '设计源文件暂不支持在线预览，请下载后查看。',
};
const extOf = (name: string) => { const m = /\.([a-z0-9]+)$/i.exec(name.trim()); return m ? m[1].toLowerCase() : ''; };

/** 判断附件能否在线预览：先看扩展名，再看 MIME。 */
export function previewKind(file: PreviewFile): { kind: PreviewKind; reason?: string } {
  const ext = extOf(file.name), mime = (file.mimeType || '').toLowerCase();
  if (UNSUPPORTED_REASON[ext]) return { kind: 'unsupported', reason: UNSUPPORTED_REASON[ext] };
  if (EXT[ext]) return { kind: EXT[ext] };
  if (mime === 'application/pdf') return { kind: 'pdf' };
  if (mime.startsWith('image/') && !/hei[cf]/.test(mime)) return { kind: 'image' };
  if (mime.includes('wordprocessingml')) return { kind: 'docx' };
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || mime === 'text/csv') return { kind: 'sheet' };
  if (mime.startsWith('text/') || mime === 'application/json') return { kind: 'text' };
  if (mime.startsWith('video/')) return { kind: 'video' };
  if (mime.startsWith('audio/')) return { kind: 'audio' };
  return { kind: 'unsupported', reason: '此格式暂不支持在线预览，请下载后用对应软件查看。' };
}
const KIND_LABEL: Record<PreviewKind, string> = { image: '图片', pdf: 'PDF', docx: 'Word 文档', sheet: '表格', text: '文本', video: '视频', audio: '音频', unsupported: '文件' };
const KIND_ICON: Record<PreviewKind, LucideIcon> = { image: ImageIcon, pdf: FileText, docx: FileText, sheet: FileSpreadsheet, text: FileText, video: FileVideo, audio: Music, unsupported: FileIcon };
export const previewIcon = (file: PreviewFile) => KIND_ICON[previewKind(file).kind];
export function formatFileSize(size?: number) {
  if (!size || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

type Zoom = 'fit' | number;
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const stepZoom = (z: Zoom, dir: 1 | -1, fitScale = 1): number => { const cur = z === 'fit' ? fitScale : z; const next = dir > 0 ? ZOOMS.find(v => v > cur + 0.001) : [...ZOOMS].reverse().find(v => v < cur - 0.001); return next ?? cur; };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export type FilePreviewProps = {
  files: PreviewFile[]; index: number; onIndex: (index: number) => void; onClose: () => void;
  load: (file: PreviewFile) => Promise<Blob>; onDownload?: (file: PreviewFile) => Promise<void> | void;
  /** Labels in file order, used only for the preview title. */
  displayNames?: readonly string[];
  /** One-based PDF page for this opening. Omit when switching to a different attachment. */
  initialPdfPage?: number;
  /** Exact visible workbook sheet name for this opening. Omit when switching attachments. */
  initialSheetName?: string;
  initialSheetRow?: number;
};

/** 附件预览浮层：大尺寸查看，支持多附件左右切换、图片/PDF 缩放、下载。 */
export function FilePreview({ files, index, onIndex, onClose, load, onDownload, displayNames, initialPdfPage, initialSheetName, initialSheetRow }: FilePreviewProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const file = files[index];
  const open = !!file;
  const jumpTrigger = React.useRef<HTMLButtonElement>(null);
  const jumpField = React.useRef<HTMLInputElement>(null);
  const [jumpEntry, setJumpEntry] = React.useState<string>();
  const [jumpInvalid, setJumpInvalid] = React.useState(false);
  const [pdfJump, setPdfJump] = React.useState<{fileId:string;page:number}>();
  const jumpOpen = jumpEntry !== undefined;
  const dismissJump = () => {
    jumpTrigger.current?.focus();
    setJumpEntry(undefined);
    setJumpInvalid(false);
  };
  useModalFocus(open, () => { if (jumpOpen) dismissJump(); else onClose(); }, ref);
  React.useLayoutEffect(() => {
    if (jumpOpen) { jumpField.current?.focus(); jumpField.current?.select(); }
  }, [jumpOpen]);
  const cache = React.useRef(new Map<string, Promise<Blob>>());
  const [blob, setBlob] = React.useState<Blob | null>(null), [downloadError, setDownloadError] = React.useState('');
  const [error, setError] = React.useState<{message?:string;retryable:boolean}>();
  const reportFailure = (message?:string, retryable=false) => setError({message,retryable});
  const [readAttempt, retryRead] = React.useReducer((attempt: number) => attempt + 1, 0);
  const [zoom, setZoom] = React.useState<Zoom>('fit'), [rotate, setRotate] = React.useState(0), [fitScale, setFitScale] = React.useState(1);
  const [pdfPosition, setPdfPosition] = React.useState<{fileId:string;page:number;total:number}>();
  const fileId = file?.id;
  const reportPdfPosition = React.useCallback((page:number, total:number) => {
    if (fileId) setPdfPosition(previous => previous?.fileId === fileId && previous.page === page && previous.total === total
      ? previous : { fileId, page, total });
  }, [fileId]);
  const info = file ? previewKind(file) : { kind: 'unsupported' as PreviewKind };
  React.useEffect(() => {
    if (!file) return; let live = true;
    setBlob(null); setError(undefined); setDownloadError(''); setZoom('fit'); setRotate(0); setFitScale(1); setPdfPosition(undefined); setJumpEntry(undefined); setJumpInvalid(false); setPdfJump(undefined);
    if (info.kind === 'unsupported') return;
    let p = cache.current.get(file.id); if (!p) { p = load(file); cache.current.set(file.id, p); p.catch(() => cache.current.delete(file.id)); }
    p.then(b => { if (live) setBlob(b); }, e => { if (live) reportFailure(e instanceof Error ? e.message : '附件读取失败',true); });
    return () => { live = false; };
  }, [file?.id, readAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const many = files.length > 1;
  const go = (d: 1 | -1) => { if (many) onIndex((index + d + files.length) % files.length); };
  const zoomable = info.kind === 'image' || info.kind === 'pdf';
  const onPreviewKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { target, currentTarget, key } = event;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    if (!(target instanceof HTMLElement) || !currentTarget.contains(target) || currentTarget.hasAttribute('inert')) return;
    if (target.isContentEditable || target.matches('input, textarea, select')) return;
    if (many && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      go(key === 'ArrowLeft' ? -1 : 1);
    } else if (zoomable && (key === '+' || key === '=')) setZoom(z => stepZoom(z, 1, fitScale));
    else if (zoomable && key === '-') setZoom(z => stepZoom(z, -1, fitScale));
    else if (zoomable && key === '0') setZoom('fit');
  };
  if (!file) return null;
  const download = async () => { if (!onDownload) return; setDownloadError(''); try { await onDownload(file); } catch (e) { setDownloadError(e instanceof Error ? e.message : '下载失败'); } };
  const retry = () => { ref.current?.focus(); retryRead(); };
  const currentPdf = info.kind === 'pdf' && pdfPosition?.fileId === file.id ? pdfPosition : undefined;
  const pageLabel = currentPdf ? ui`第 ${currentPdf.page} 页，共 ${currentPdf.total} 页` : '';
  const sub = [uiText(KIND_LABEL[info.kind]), formatFileSize(file.size)].filter(Boolean).join(' · ');
  const canJump = currentPdf && currentPdf.total > 1 && !error;
  const submitJump = (event:React.FormEvent) => {
    event.preventDefault();
    if (!currentPdf || jumpEntry === undefined) return;
    const value = jumpEntry.trim();
    const page = Number(value);
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(page) || page < 1 || page > currentPdf.total) {
      setJumpInvalid(true);
      jumpField.current?.focus();
      return;
    }
    setPdfJump({ fileId:file.id, page });
    dismissJump();
  };
  const displayName = displayNames?.[index] ?? file.name;
  const nameSuffix = displayName.startsWith(file.name) ? displayName.slice(file.name.length) : '';
  const currentScale = zoom === 'fit' ? fitScale : zoom;
  return <Portal><div className="mist-scrim" onClick={onClose} />
    <div ref={ref} tabIndex={-1} className="mist-dialog mist-viewer" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} data-file-preview={file.id} data-preview-kind={info.kind} onKeyDown={onPreviewKeyDown}>
      <div className="mist-viewer-h">
        <Tile icon={KIND_ICON[info.kind]} size="sm" />
        <div className="mist-viewer-title">
          <div id={`${id}-title`} className="mist-h2" role="heading" aria-level={2} aria-label={displayName}
            title={displayName} data-has-suffix={nameSuffix ? true : undefined}>
            {nameSuffix ? <><span className="mist-viewer-filename">{file.name}</span><span>{nameSuffix}</span></> : displayName}
          </div>
          <span className="mist-muted">{sub}{pageLabel && <> · {canJump
            ? <button ref={jumpTrigger} type="button" className="mist-viewer-page-jump" title={uiText('跳转页码')}
                aria-expanded={jumpOpen} aria-controls={jumpOpen ? `${id}-page-jump` : undefined}
                onClick={() => jumpOpen ? dismissJump() : setJumpEntry(String(currentPdf.page))}>{pageLabel}</button>
            : pageLabel}</>}</span>
        </div>
        <div className="mist-viewer-tools">
          {zoomable && blob && <div className="mist-viewer-group" role="group" aria-label={uiText("缩放")}>
            <IconButton icon={Minus} label={uiText("缩小")} size="sm" onClick={() => setZoom(z => stepZoom(z, -1, fitScale))} />
            <button type="button" className="mist-viewer-zoom" onClick={() => setZoom(z => z === 'fit' ? 1 : 'fit')} title={uiText(zoom === 'fit' ? '切换到 100%' : '适应窗口')}>{uiText(zoom === 'fit' ? '适应' : pct(currentScale))}</button>
            <IconButton icon={Plus} label={uiText("放大")} size="sm" onClick={() => setZoom(z => stepZoom(z, 1, fitScale))} />
            {info.kind === 'image' ? <IconButton icon={RotateCw} label={uiText("旋转")} size="sm" onClick={() => setRotate(r => (r + 90) % 360)} /> : <IconButton icon={Maximize} label={uiText("适应宽度")} size="sm" onClick={() => setZoom('fit')} />}
          </div>}
          {many && <div className="mist-viewer-group" role="group" aria-label={uiText("切换附件")}>
            <IconButton icon={ChevronLeft} label={uiText("上一个附件")} size="sm" onClick={() => go(-1)} />
            <span className="mist-viewer-count">{uiText(index + 1)} / {files.length}</span>
            <IconButton icon={ChevronRight} label={uiText("下一个附件")} size="sm" onClick={() => go(1)} />
          </div>}
          {onDownload && <Button icon={Download} size="sm" onClick={() => void download()}>{uiText("下载")}</Button>}
        </div>
        <span className="mist-viewer-close"><IconButton icon={X} label={uiText("关闭")} size="sm" onClick={onClose} /></span>
      </div>
      {canJump && jumpOpen && <form id={`${id}-page-jump`} className="mist-viewer-note mist-viewer-jump-form" onSubmit={submitJump}>
        <TextInput ref={jumpField} className="mist-viewer-page-field" autoComplete="off" inputMode="numeric"
          aria-label={uiText('PDF 页码')} aria-invalid={jumpInvalid || undefined}
          aria-describedby={jumpInvalid ? `${id}-page-error` : undefined}
          maxLength={12} value={jumpEntry} onChange={event => { setJumpEntry(event.target.value); setJumpInvalid(false); }} />
        <Button type="submit" size="sm">{uiText('跳转')}</Button>
        {jumpInvalid && <span id={`${id}-page-error`} role="alert">{ui`请输入 1 至 ${currentPdf.total} 的整数页码`}</span>}
      </form>}
      {downloadError && <div className="mist-viewer-note"><Banner tone="bad" title={uiText("下载失败")}>{downloadError}</Banner></div>}
      <div className="mist-viewer-stage" data-kind={info.kind}>
        {info.kind === 'unsupported' ? <Unsupported reason={info.reason} onDownload={onDownload ? download : undefined} />
          : error ? <div className="mist-viewer-center"><EmptyState icon={FileQuestion} title={uiText("预览未能打开")} description={error.message ? uiText(error.message) : undefined} action={(error.retryable || onDownload) && <div className="mist-row">
            {error.retryable && <Button onClick={retry}>{uiText('重试')}</Button>}
            {onDownload && <Button icon={Download} onClick={() => void download()}>{uiText("下载原件")}</Button>}
          </div>} /></div>
          : !blob ? <Loading />
          : <Renderer key={file.id} kind={info.kind} blob={blob} name={file.name} zoom={zoom} rotate={rotate} onFitScale={setFitScale} onPdfPosition={reportPdfPosition} onFail={reportFailure} pdfJump={pdfJump?.fileId === file.id ? pdfJump : undefined} initialPdfPage={initialPdfPage} initialSheetName={initialSheetName} initialSheetRow={initialSheetRow} />}
      </div>
    </div></Portal>;
}

function Loading() { return <div className="mist-viewer-center" aria-busy="true"><div className="mist-col" style={{ gap: 10, width: 'min(420px, 80%)' }}><Skeleton height={14} width="60%" /><Skeleton height={12} /><Skeleton height={12} width="85%" /><span className="mist-muted">{uiText("正在加载预览…")}</span></div></div>; }
function Unsupported({ reason, onDownload }: { reason?: string; onDownload?: () => void }) {
  return <div className="mist-viewer-center"><EmptyState icon={FileQuestion} title={uiText("此格式暂不支持在线预览")} description={uiText(reason)} action={onDownload ? <Button icon={Download} onClick={onDownload}>{uiText("下载原件")}</Button> : undefined} /></div>;
}

type RendererProps = { kind: PreviewKind; blob: Blob; name: string; zoom: Zoom; rotate: number; onFitScale: (v: number) => void; onPdfPosition: (page: number, total: number) => void; onFail: (msg?: string,retryable?:boolean) => void; pdfJump?: {page:number}; initialPdfPage?: number; initialSheetName?: string; initialSheetRow?: number };
function Renderer(p: RendererProps) {
  switch (p.kind) {
    case 'image': return <ImageView {...p} />;
    case 'pdf': return <PdfView {...p} />;
    case 'docx': return <DocxView {...p} />;
    case 'sheet': return <SheetView {...p} />;
    case 'text': return <TextView {...p} />;
    case 'video': case 'audio': return <MediaView {...p} />;
    default: return null;
  }
}
function useObjectUrl(blob: Blob) {
  const url = React.useMemo(() => URL.createObjectURL(blob), [blob]);
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

function ImageView({ blob, name, zoom, rotate, onFitScale, onFail }: RendererProps) {
  const url = useObjectUrl(blob), box = React.useRef<HTMLDivElement>(null);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const turned = rotate % 180 !== 0;
  const fit = React.useMemo(() => {
    const el = box.current; if (!natural || !el) return 1;
    const w = turned ? natural.h : natural.w, h = turned ? natural.w : natural.h;
    return Math.min(1, (el.clientWidth - 32) / w, (el.clientHeight - 32) / h);
  }, [natural, turned]);
  React.useEffect(() => { onFitScale(fit); }, [fit, onFitScale]);
  const scale = zoom === 'fit' ? fit : zoom;
  const w = natural ? natural.w * scale : undefined, h = natural ? natural.h * scale : undefined;
  const frameW = natural ? (turned ? h : w) : undefined, frameH = natural ? (turned ? w : h) : undefined;
  return <div ref={box} className="mist-viewer-scroll mist-viewer-image">
    <div className="mist-viewer-frame" style={{ width: frameW, height: frameH }}>
      <img src={url} alt={uiText(name)} draggable={false} onLoad={e => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })} onError={() => onFail('图片无法显示，文件可能已损坏')}
        style={natural ? { width: w, height: h, transform: `rotate(${rotate}deg)` } : { maxWidth: '100%' }} />
    </div>
  </div>;
}

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; destroy: () => Promise<void> };
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  // A prior octet-stream response may be immutable in an existing browser cache.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default + (worker.default.includes('?') ? '&' : '?') + 'module=1';
  return pdfjs;
}
// Page containers are in document order, so scrolling only needs to sample a few offsets.
function pageAtScrollPosition(pane: HTMLDivElement): number {
  const { children, scrollTop, scrollHeight, clientHeight } = pane;
  const max = scrollHeight - clientHeight;
  if (max > 1 && scrollTop >= max - 1) return children.length;
  let first = 0, last = children.length - 1;
  while (first < last) {
    const middle = Math.ceil((first + last) / 2);
    const page = children.item(middle) as HTMLElement;
    if (page.offsetTop <= scrollTop + 1) first = middle;
    else last = middle - 1;
  }
  return first + 1;
}

function PdfView({ blob, zoom, onFitScale, onPdfPosition, onFail, pdfJump, initialPdfPage }: RendererProps) {
  const box = React.useRef<HTMLDivElement>(null);
  const openingPage = React.useRef(initialPdfPage).current;
  const lastZoom = React.useRef(zoom);
  const hasOpeningPage = openingPage !== undefined && Number.isSafeInteger(openingPage) && openingPage > 1;
  const targetPage = React.useRef(hasOpeningPage ? openingPage : undefined);
  const handledJump = React.useRef<typeof pdfJump>(undefined);
  const positionFrame = React.useRef<number | null>(null);
  const pageFrame = React.useRef<number | null>(null);
  const lastAlignment = React.useRef<{ top: number; max: number } | null>(null);
  const releasePageAnchor = React.useCallback(() => {
    targetPage.current = undefined;
    if (positionFrame.current !== null) window.cancelAnimationFrame(positionFrame.current);
    positionFrame.current = null;
  }, []);
  const [doc, setDoc] = React.useState<PdfDoc | null>(null), [base, setBase] = React.useState<{ w: number; h: number } | null>(null), [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    let live = true, loaded: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const d = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise as unknown as PdfDoc; loaded = d;
        if (!live) { void d.destroy(); return; }
        const first = await d.getPage(1), vp = first.getViewport({ scale: 1 });
        if (!live) return; setBase({ w: vp.width, h: vp.height }); setDoc(d);
        if (!hasOpeningPage) onPdfPosition(1, d.numPages);
      } catch (e) {
        if (!live) return;
        const name=(e as { name?: string })?.name;
        if (name === 'PasswordException') onFail('该 PDF 设有打开密码，请下载后输入密码查看');
        else if (name === 'InvalidPDFException') onFail('PDF 无法解析，文件可能已损坏');
        else onFail(undefined,true);
      }
    })();
    return () => { live = false; if (loaded) void loaded.destroy(); };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setWidth(el.clientWidth); measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null; ro?.observe(el); return () => ro?.disconnect();
  }, []);
  const fit = base && width ? Math.max(0.2, Math.min(1.6, (width - 40) / base.w)) : 1;
  React.useEffect(() => { onFitScale(fit); }, [fit, onFitScale]);
  const scale = zoom === 'fit' ? fit : zoom;
  const alignPageAnchor = React.useCallback(() => {
    const scroll = box.current;
    if (!scroll || !doc || !width || targetPage.current === undefined) return;
    const page = Math.min(targetPage.current, doc.numPages);
    const target = scroll.children.item(page - 1);
    if (!(target instanceof HTMLElement)) return;
    scroll.scrollTop = page === 1 ? 0 : target.offsetTop;
    lastAlignment.current = { top: scroll.scrollTop, max: scroll.scrollHeight - scroll.clientHeight };
    onPdfPosition(page, doc.numPages);
  }, [doc, width, onPdfPosition]);
  const updateVisiblePage = React.useCallback(() => {
    if (!doc || targetPage.current !== undefined || pageFrame.current !== null) return;
    pageFrame.current = window.requestAnimationFrame(() => {
      pageFrame.current = null;
      const pane = box.current;
      if (targetPage.current === undefined && pane?.children.length) onPdfPosition(pageAtScrollPosition(pane), doc.numPages);
    });
  }, [doc, onPdfPosition]);
  React.useEffect(() => () => {
    if (pageFrame.current !== null) window.cancelAnimationFrame(pageFrame.current);
  }, []);
  const onPageLayout = React.useCallback(() => {
    // Mixed page dimensions replace estimates as nearby pages render. Batch realignment without loading more canvases.
    if (targetPage.current === undefined) { updateVisiblePage(); return; }
    if (positionFrame.current !== null) return;
    positionFrame.current = window.requestAnimationFrame(() => {
      positionFrame.current = null;
      alignPageAnchor();
    });
  }, [alignPageAnchor, updateVisiblePage]);
  React.useLayoutEffect(() => {
    if (lastZoom.current !== zoom) {
      lastZoom.current = zoom;
      releasePageAnchor();
    }
    if (pdfJump && handledJump.current !== pdfJump && doc && width) {
      handledJump.current = pdfJump;
      targetPage.current = pdfJump.page;
    }
    alignPageAnchor();
    updateVisiblePage();
    return () => {
      if (positionFrame.current !== null) window.cancelAnimationFrame(positionFrame.current);
      positionFrame.current = null;
    };
  }, [alignPageAnchor, doc, pdfJump, releasePageAnchor, updateVisiblePage, width, zoom]);
  React.useEffect(() => {
    const dialog = box.current?.closest('[role="dialog"]');
    if (!dialog) return;
    const scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '];
    const handleKey = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || !scrollKeys.includes(event.key)) return;
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (target?.closest('input, textarea, select, [contenteditable]') || event.key === ' ' && target?.closest('button')) return;
      releasePageAnchor();
    };
    dialog.addEventListener('keydown', handleKey);
    return () => dialog.removeEventListener('keydown', handleKey);
  }, [releasePageAnchor]);
  const trackScroll = ({ currentTarget: pane }: React.UIEvent<HTMLDivElement>) => {
    const alignment = lastAlignment.current;
    // A stable scroll range with a new position also covers native scrollbar navigation.
    if (targetPage.current !== undefined && alignment && pane.scrollHeight - pane.clientHeight === alignment.max
      && Math.abs(pane.scrollTop - alignment.top) > 1) releasePageAnchor();
    updateVisiblePage();
  };
  return <div ref={box} className="mist-viewer-scroll mist-viewer-pages"
    onWheel={releasePageAnchor} onPointerDown={releasePageAnchor} onTouchStart={releasePageAnchor} onScroll={trackScroll}>
    {doc && base ? Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} scale={scale} base={base} root={box} onLayout={onPageLayout} />) : <Loading />}
  </div>;
}
function PdfPage({ doc, n, scale, base, root, onLayout }: { doc: PdfDoc; n: number; scale: number; base: { w: number; h: number }; root: React.RefObject<HTMLDivElement | null>; onLayout?: () => void }) {
  const wrap = React.useRef<HTMLDivElement>(null), canvas = React.useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = React.useState(n <= 2), [size, setSize] = React.useState({ w: base.w * scale, h: base.h * scale });
  React.useLayoutEffect(() => { onLayout?.(); }, [size.w, size.h, onLayout]);
  React.useEffect(() => {
    const el = wrap.current; if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { root: root.current, rootMargin: '600px 0px' });
    io.observe(el); return () => io.disconnect();
  }, [root]);
  React.useEffect(() => {
    if (!visible) { setSize({ w: base.w * scale, h: base.h * scale }); return; }
    let live = true, task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await doc.getPage(n); if (!live) return;
      const vp = page.getViewport({ scale }), ratio = Math.min(window.devicePixelRatio || 1, 2), c = canvas.current; if (!c) return;
      c.width = Math.floor(vp.width * ratio); c.height = Math.floor(vp.height * ratio); setSize({ w: vp.width, h: vp.height });
      const ctx = c.getContext('2d'); if (!ctx) return;
      task = page.render({ canvasContext: ctx, canvas: c, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      try { await task!.promise; } catch { /* 切换缩放时取消上一轮渲染 */ }
    })();
    return () => { live = false; task?.cancel(); };
  }, [visible, scale, doc, n, base.w, base.h]);
  return <div ref={wrap} className="mist-viewer-page" style={{ width: size.w, height: size.h }} aria-label={ui`第 ${n} 页`}><canvas ref={canvas} style={{ width: size.w, height: size.h }} /></div>;
}

function DocxView({ blob, onFail }: RendererProps) {
  const host = React.useRef<HTMLDivElement>(null), [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let live = true; const el = host.current; if (!el) return;
    (async () => {
      try {
        const { renderAsync } = await import('docx-preview'); if (!live) return;
        el.innerHTML = '';
        await renderAsync(blob, el, undefined, { className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true, experimental: false, useBase64URL: true });
        if (!live) return;
        // 文档里的链接只允许 http(s)/mailto，并在新窗口打开，避免文档内容在本页执行脚本。
        el.querySelectorAll('a[href]').forEach(a => { const href = a.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); } else if (!href.startsWith('#')) a.removeAttribute('href'); });
        setReady(true);
      } catch { if (live) onFail('Word 文档无法解析，请下载后用 Word 打开'); }
    })();
    return () => { live = false; };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="mist-viewer-scroll mist-viewer-docx">{!ready && <Loading />}<div ref={host} /></div>;
}

const MAX_ROWS = 1000, MAX_COLS = 60;
const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function SheetView({ blob, name, onFail, initialSheetName, initialSheetRow }: RendererProps) {
  const [book, setBook] = React.useState<{ names: string[]; rows: Record<string, string[][]>; truncated: Record<string, boolean>; origins: Record<string,{row:number;col:number}> } | null>(null), [sheet, setSheet] = React.useState('');
  const paneRef=React.useRef<HTMLDivElement>(null),targetRow=React.useRef<HTMLTableRowElement>(null);
  React.useLayoutEffect(()=>{
    const pane = paneRef.current, row = targetRow.current, table = row?.closest('table');
    if (!pane) return;
    pane.style.removeProperty('--mist-sheet-citation-space');
    if (!row || !table) return;
    const viewport = pane.getBoundingClientRect(), rect = row.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const scrollTo = pane.scrollTop + center - viewport.top - viewport.height / 2;
    // A citation near the end needs scroll space beyond the last physical row.
    const space = Math.ceil(center + viewport.height / 2 - table.getBoundingClientRect().bottom);
    if (scrollTo > 0 && space > 0) pane.style.setProperty('--mist-sheet-citation-space', `${space}px`);
    pane.scrollTop = Math.max(0, scrollTo);
  },[book,sheet,initialSheetRow]);
  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const XLSX = await import('xlsx');
        const ext = extOf(name);
        const wb = ext === 'csv' || ext === 'tsv' ? XLSX.read(await blob.text(), { type: 'string', raw: true, FS: ext === 'tsv' ? '\t' : undefined } as any) : XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellDates: true });
        const rows: Record<string, string[][]> = {}, truncated: Record<string, boolean> = {};
        const origins:Record<string,{row:number;col:number}>={};
        for (const n of wb.SheetNames) {
          const worksheet=wb.Sheets[n],range=XLSX.utils.decode_range(worksheet['!ref']??'A1');
          const all = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false, defval: '', blankrows: true }) as string[][];
          let last = all.length; while (last > 0 && all[last - 1].every(v => String(v ?? '') === '')) last--;
          const used = all.slice(0, last);
          const target=n===initialSheetName&&initialSheetRow!==undefined?initialSheetRow-range.s.r-1:-1;
          const first=target>=0&&target<used.length?Math.floor(target/MAX_ROWS)*MAX_ROWS:0;
          origins[n]={row:range.s.r+first,col:range.s.c};
          truncated[n] = used.length > MAX_ROWS || used.some(r => r.length > MAX_COLS);
          rows[n] = used.slice(first, first+MAX_ROWS).map(r => r.slice(0, MAX_COLS).map(v => String(v ?? '')));
        }
        if (!live) return;
        const openingSheets = initialSheetName === undefined
          ? wb.SheetNames
          : wb.SheetNames.filter((_, index) => !wb.Workbook?.Sheets?.[index]?.Hidden);
        setBook({ names: wb.SheetNames, rows, truncated, origins });
        setSheet(openingSheets.find(sheetName => sheetName === initialSheetName) ?? openingSheets[0] ?? '');
      } catch { if (live) onFail('表格无法解析，请下载后用 Excel 打开'); }
    })();
    return () => { live = false; };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!book) return <Loading />;
  const rows = book.rows[sheet] || [], cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const origin=book.origins[sheet]??{row:0,col:0};
  const target=sheet===initialSheetName?initialSheetRow:undefined;
  return <div className="mist-viewer-sheet">
    {book.names.length > 1 && <div className="mist-viewer-tabs" role="tablist" aria-label={uiText("工作表")}>{book.names.map(n => <button key={n} type="button" role="tab" aria-selected={n === sheet} className="mist-viewer-tab" onClick={() => setSheet(n)}>{n}</button>)}</div>}
    {book.truncated[sheet] && <p className="mist-note">{origin.row>0?ui`显示第 ${origin.row+1} 至 ${origin.row+rows.length} 行，最多 ${MAX_COLS} 列。完整内容请下载原件。`:
      <>{uiText("仅显示前 ")}{MAX_ROWS}{uiText(" 行、")}{MAX_COLS}{uiText(" 列，完整内容请下载原件。")}</>}</p>}
    <div className="mist-viewer-scroll" ref={paneRef}>{rows.length ? <table className="mist-viewer-table" aria-label={uiText(sheet)}>
      <thead><tr><th aria-hidden="true" />{Array.from({ length: cols }, (_, i) => <th key={i} scope="col">{colName(origin.col+i)}</th>)}</tr></thead>
      <tbody>{rows.map((r,i)=>{
        const row=origin.row+i+1,cited=row===target;
        return <tr key={row} ref={cited?targetRow:undefined} data-cited={cited||undefined} aria-current={cited?'location':undefined}>
          <th scope="row">{uiText(row)}</th>{Array.from({length:cols},(_,j)=><td key={j}>{r[j]??''}</td>)}
        </tr>;
      })}</tbody>
    </table> : <div className="mist-viewer-center"><EmptyState compact title={uiText("这个工作表是空的")} /></div>}</div>
  </div>;
}

const MAX_TEXT = 2 * 1024 * 1024;
function TextView({ blob }: RendererProps) {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => { let live = true; void blob.slice(0, MAX_TEXT).text().then(t => { if (live) setText(t); }); return () => { live = false; }; }, [blob]);
  if (text === null) return <Loading />;
  return <div className="mist-viewer-scroll">{blob.size > MAX_TEXT && <p className="mist-note">{uiText("仅显示前 2 MB，完整内容请下载原件。")}</p>}<pre className="mist-viewer-text">{text}</pre></div>;
}
function MediaView({ blob, kind, name, onFail }: RendererProps) {
  const url = useObjectUrl(blob);
  return <div className="mist-viewer-center">{kind === 'video'
    ? <video className="mist-viewer-video" src={url} controls playsInline onError={() => onFail('视频无法播放，可能是浏览器不支持的编码，请下载后查看')} aria-label={uiText(name)} />
    : <audio src={url} controls onError={() => onFail('音频无法播放，请下载后查看')} aria-label={uiText(name)} />}</div>;
}
