export type GeneratedExportRequest = { filename: string; rowCount: number; run: () => void };
export const GENERATED_EXPORT_EVENT = 'bambook:confirm-generated-export';

/** Generated exports must be accepted by the active application confirmation host. */
export function requestGeneratedExport(request: GeneratedExportRequest) {
  const event = new CustomEvent<GeneratedExportRequest>(GENERATED_EXPORT_EVENT, { cancelable: true, detail: request });
  if (document.dispatchEvent(event)) throw new Error('导出确认不可用，请刷新后重试');
}

/** Start a browser download after confirmation; existing file downloads use their own path. */
export function downloadGeneratedBlob(blob: Blob, filename: string, options: { attach?: boolean; revokeAfter?: number } = {}) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  if (options.attach) document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); if (options.revokeAfter === 0) URL.revokeObjectURL(url); else window.setTimeout(() => URL.revokeObjectURL(url), options.revokeAfter ?? 1000); }
}
