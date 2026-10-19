import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fail } from './errors';
import { imagePreview, type ImagePreviewMode } from './imagePreview';
import {automaticCutout,imageCutoutVersion} from './backgroundRemoval';
export const MIST_FILE_MAX_BYTES = 50 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type MistFileInput = { bytes: Buffer; name: string; mimeType: string; multipartFilename?: boolean };
export type MistStoredFile = { id: string; name: string; mimeType: string; size: number; storageKey: string; createdAt: string; uploadedBy?: string };
export function validateFileInput(input: MistFileInput) {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > MIST_FILE_MAX_BYTES) fail('INVALID_FILE', '请上传一个不超过50MiB的实际文件', 400);
  const name = path.basename(input.name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name === '.' || name === '..' || name.length > 180) fail('INVALID_FILE', '文件名无效或过长', 400);
  return { name, mimeType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(input.mimeType) ? input.mimeType : 'application/octet-stream', size: input.bytes.length, sha256: createHash('sha256').update(input.bytes).digest('hex') };
}
/** Decode only stored multipart display names; keep raw validation metadata stable for request replay. */
function multipartDisplayName(name: string): string {
  if ([...name].some(char => char.charCodeAt(0) > 255)) return name;
  const bytes = Buffer.from(name, 'latin1');
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : name;
  } catch { return name; }
}
export class MistPrivateFiles {
  constructor(private readonly root: string,private readonly cutoutQueue=process.env.BAMBOOK_IMAGE_CUTOUT_QUEUE?.trim()||'') {}
  private checked(workspaceId: string, fileId: string) {
    if (!UUID.test(workspaceId) || !UUID.test(fileId)) fail('INVALID_FILE_PATH', '附件路径无效', 400);
    const root = path.resolve(this.root), file = path.resolve(root, workspaceId, fileId);
    if (!file.startsWith(root + path.sep)) fail('INVALID_FILE_PATH', '附件路径无效', 400);
    return { root, file, directory: path.dirname(file) };
  }
  async write(workspaceId: string, input: MistFileInput, now: string): Promise<MistStoredFile> { return this.writeWithId(workspaceId, randomUUID(), input, now); }
  /** 以既定附件 ID 写入（演示工作区创建时使用）；ID 必须是 UUID 且尚不存在。 */
  async writeWithId(workspaceId: string, id: string, input: MistFileInput, now: string): Promise<MistStoredFile> {
    const meta = validateFileInput(input), target = this.checked(workspaceId, id);
    await fs.mkdir(target.directory, { recursive: true, mode: 0o700 });
    const realRoot = await fs.realpath(target.root), realDirectory = await fs.realpath(target.directory);
    if (realDirectory !== path.join(realRoot, workspaceId)) fail('INVALID_FILE_PATH', '附件目录无效', 400);
    const handle = await fs.open(target.file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(input.bytes); } catch (error) { await handle.close(); await fs.unlink(target.file).catch(() => undefined); throw error; }
    await handle.close();
    const stored={ id, name: input.multipartFilename ? multipartDisplayName(meta.name) : meta.name, mimeType: meta.mimeType, size: meta.size, storageKey: `${workspaceId}/${id}`, createdAt: now };
    if (meta.mimeType.startsWith('image/')) {await Promise.allSettled((['thumb', 'display'] as const).map(mode => this.writePreview(target.file, input.bytes, meta.mimeType, mode)));await this.enqueueCutout(workspaceId,stored);}
    return stored;
  }
  private previewPath(file: string, mode: ImagePreviewMode) { return `${file}.preview-${mode}${mode.startsWith('cutout-')?'.'+imageCutoutVersion():''}.webp`; }
  private async writePreview(file: string, bytes: Buffer, mimeType: string, mode: ImagePreviewMode) {
    const preview = await imagePreview(bytes, mimeType, mode);return this.writePreviewBytes(file,mode,preview);
  }
  private async writePreviewBytes(file:string,mode:ImagePreviewMode,preview:Buffer){
    const destination = this.previewPath(file, mode), temporary = `${destination}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(preview); await handle.close(); await fs.rename(temporary, destination); }
    catch (error) { await handle.close().catch(() => undefined); await fs.unlink(temporary).catch(() => undefined); throw error; }
    return preview;
  }
  private async enqueueCutout(workspaceId:string,file:MistStoredFile){
    if(!this.cutoutQueue||!file.mimeType.startsWith('image/'))return;
    await fs.mkdir(this.cutoutQueue,{recursive:true,mode:0o700});const target=path.join(this.cutoutQueue,`${workspaceId}.${file.id}.json`);
    try{const handle=await fs.open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(JSON.stringify({workspaceId,file})+'\n');}finally{await handle.close();}}
    catch(error:any){if(error?.code!=='EEXIST')throw error;}
  }
  async read(workspaceId: string, file: MistStoredFile): Promise<Buffer> {
    if (file.storageKey !== `${workspaceId}/${file.id}`) fail('INVALID_FILE_PATH', '附件不属于当前工作区', 404);
    const target = this.checked(workspaceId, file.id);
    let handle;
    try {
      const realRoot = await fs.realpath(target.root), realDirectory = await fs.realpath(target.directory);
      if (realDirectory !== path.join(realRoot, workspaceId)) fail('INVALID_FILE_PATH', '附件目录无效', 404);
      handle = await fs.open(target.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    catch { fail('FILE_NOT_FOUND', '附件原文件不存在', 404); }
    try {
      const stat = await handle!.stat();
      if (!stat.isFile() || stat.size !== file.size || stat.size > MIST_FILE_MAX_BYTES) fail('FILE_NOT_FOUND', '附件原文件无法核验', 404);
      return await handle!.readFile();
    } finally { await handle!.close(); }
  }
  async readPreview(workspaceId: string, file: MistStoredFile, mode: ImagePreviewMode): Promise<Buffer> {
    if (file.storageKey !== `${workspaceId}/${file.id}`) fail('INVALID_FILE_PATH', '附件不属于当前工作区', 404);
    const target = this.checked(workspaceId, file.id), derivative = this.previewPath(target.file, mode);
    try {
      const handle = await fs.open(derivative, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const stat = await handle.stat(); if (stat.isFile() && stat.size > 0) return await handle.readFile(); }
      finally { await handle.close(); }
    } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    if(mode.startsWith('cutout-')){await this.enqueueCutout(workspaceId,file);return this.readPreview(workspaceId,file,mode.endsWith('thumb')?'thumb':'display');}
    const original = await this.read(workspaceId, file);
    try { return await this.writePreview(target.file, original, file.mimeType, mode); }
    catch (error: any) {
      if (error?.code === 'EEXIST') return fs.readFile(derivative);
      throw error;
    }
  }
  async previewReady(workspaceId:string,file:MistStoredFile,mode:ImagePreviewMode){if(file.storageKey!==`${workspaceId}/${file.id}`)return false;try{const info=await fs.stat(this.previewPath(this.checked(workspaceId,file.id).file,mode));return info.isFile()&&info.size>0;}catch{return false;}}
  async generateCutouts(workspaceId:string,file:MistStoredFile){
    const original=await this.read(workspaceId,file),cutout=await automaticCutout(original);if(!cutout)throw new Error('背景移除模型未生成有效蒙版');
    const target=this.checked(workspaceId,file.id).file;
    for(const [mode,base] of [['cutout-thumb','thumb'],['cutout-display','display']] as const){const preview=await imagePreview(cutout,'image/png',base);await this.writePreviewBytes(target,mode,preview);}
  }
  async remove(workspaceId: string, file: MistStoredFile) {
    if (file.storageKey !== `${workspaceId}/${file.id}`) fail('INVALID_FILE_PATH', '附件不属于当前工作区', 404);
    const target = this.checked(workspaceId, file.id).file;
    await Promise.all([target,...(['thumb','display','cutout-thumb','cutout-display'] as const).map(mode=>this.previewPath(target,mode))].map(filePath => fs.unlink(filePath).catch(error => { if (error.code !== 'ENOENT') throw error; })));
    if(this.cutoutQueue)await fs.unlink(path.join(this.cutoutQueue,`${workspaceId}.${file.id}.json`)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
