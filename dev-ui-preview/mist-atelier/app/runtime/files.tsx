import React from 'react';
import { Download, Eye } from 'lucide-react';
import { Button, FilePreview, Icon, TextLink, previewIcon, formatFileSize, type PreviewFile } from '../../../../components/mist';
import type { MistFile } from '../../../../server/src/shared/mistWorkspace';
import { useMistWorkspace } from './workspace';

/**
 * 附件统一交互：点击附件名称先在线预览（PDF / 图片 / Word / Excel / 文本 / 音视频），
 * 「下载」是旁边独立的动作。多个附件时预览内可左右切换。
 */
export function useFilePreview() {
  const ws = useMistWorkspace() as ReturnType<typeof useMistWorkspace> | null;
  const [open, setOpen] = React.useState<{ files: MistFile[]; index: number } | null>(null);
  const show = React.useCallback((file: MistFile, files?: Array<MistFile | undefined | null>) => {
    const list = (files || []).filter((f): f is MistFile => !!f);
    const all = list.some(f => f.id === file.id) ? list : [file];
    setOpen({ files: all, index: Math.max(0, all.findIndex(f => f.id === file.id)) });
  }, []);
  const load = React.useCallback((file: PreviewFile) => {
    if (!ws?.readFile) return Promise.reject(new Error('当前无法读取附件原件，请下载后查看'));
    return ws.readFile(file as MistFile);
  }, [ws]);
  const download = ws?.downloadFile ? (file: PreviewFile) => ws.downloadFile(file as MistFile) : undefined;
  const node = open ? <FilePreview files={open.files} index={open.index} onIndex={index => setOpen(o => o && { ...o, index })} onClose={() => setOpen(null)} load={load} onDownload={download} /> : null;
  return { open: show, node };
}

/** 附件名称：点击打开预览。files 为同组附件（用于在预览中切换）。 */
export function FileName({ file, files, showSize, label }: { file: MistFile; files?: Array<MistFile | undefined | null>; showSize?: boolean; label?: React.ReactNode }) {
  const preview = useFilePreview();
  return <><button type="button" className="mist-file" data-file-name={file.id} title={`预览 ${file.name}`} onClick={() => preview.open(file, files)}>
    <Icon icon={previewIcon(file)} size="sm" /><span>{label ?? file.name}</span>{showSize && file.size ? <small className="mist-muted">{formatFileSize(file.size)}</small> : null}
  </button>{preview.node}</>;
}

/** 附件一行：名称（预览）+ 下载 + 其他动作。 */
export function FileRow({ file, files, onError, children, showSize }: { file: MistFile; files?: Array<MistFile | undefined | null>; onError?: (message: string) => void; children?: React.ReactNode; showSize?: boolean }) {
  const { downloadFile } = useMistWorkspace();
  return <div className="mist-file-row" data-file-row={file.id}><FileName file={file} files={files} showSize={showSize} />
    <TextLink icon={Download} onClick={() => void Promise.resolve(downloadFile(file)).catch(e => onError?.(e instanceof Error ? e.message : String(e)))}>下载</TextLink>{children}</div>;
}

/** 已有下载按钮旁补一个「预览」动作（用于生成的单据原件等）。 */
export function PreviewLink({ file, files, label = '预览' }: { file: MistFile | undefined | null; files?: Array<MistFile | undefined | null>; label?: string }) {
  const preview = useFilePreview();
  if (!file) return null;
  return <><TextLink icon={Eye} onClick={() => preview.open(file, files)}>{label}</TextLink>{preview.node}</>;
}

/** 与「下载 / 打印」按钮并列的「预览」按钮。 */
export function PreviewButton({ file, files, size = 'sm', disabled }: { file: MistFile | undefined | null; files?: Array<MistFile | undefined | null>; size?: 'sm' | 'md'; disabled?: boolean }) {
  const preview = useFilePreview();
  return <><Button size={size} variant="quiet" icon={Eye} disabled={disabled || !file} title={file ? undefined : '文件不可用或无权读取'} onClick={() => file && preview.open(file, files)}>预览</Button>{preview.node}</>;
}
