import type { MistFile } from '../../../../server/src/shared/mistWorkspace';

const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
const safeName = (name: string) => {
  const leaf = name.replace(/\\/g, '/').split('/').pop()?.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim();
  const value = !leaf || leaf === '.' || leaf === '..' ? '附件' : leaf;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? '_' + value : value;
};

export type BundleFileRef = { fileId: string; name: string };

/** Use the authenticated reader and finish all originals before exposing a download. */
export async function workspaceFileBundle(
  references: BundleFileRef[], files: MistFile[], readFile: (file: MistFile) => Promise<Blob>,
  options: { name: string; date: string; isCurrent: () => boolean; staleMessage?: string },
) {
  const check = () => {
    if (!options.isCurrent()) throw new Error(options.staleMessage || '来源已变化，请重新核对后下载');
  };
  check();
  const seen = new Set<string>();
  const selected = references.filter(ref => !seen.has(ref.fileId) && !!seen.add(ref.fileId)).map(ref => {
    const file = files.find(row => row.id === ref.fileId);
    if (!file) throw new Error(`附件不可用或无权读取：${ref.name}`);
    return { ref, file };
  });
  if (!selected.length) throw new Error('没有可打包的原件');
  if (selected.some(({ file }) => !Number.isSafeInteger(file.size) || file.size < 0)) throw new Error('附件大小待核对');
  if (selected.reduce((sum, { file }) => sum + file.size, 0) > MAX_BUNDLE_BYTES) throw new Error('附件超过200MB，请分别下载');
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip(), names = new Set<string>();
  for (const { ref, file } of selected) {
    check();
    const blob = await readFile(file);
    check();
    if (blob.size !== file.size) throw new Error(`附件原件大小不符：${ref.name}`);
    const base = safeName(ref.name), dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base, extension = dot > 0 ? base.slice(dot) : '';
    let name = base, index = 2;
    while (names.has(name.toLowerCase())) name = `${stem} (${index++})${extension}`;
    names.add(name.toLowerCase());
    zip.file(name, new Uint8Array(await blob.arrayBuffer()), { date: new Date(options.date), createFolders: false });
  }
  check();
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  check();
  return { name: safeName(options.name) + '.zip', bytes };
}
