import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {fail} from './errors';
import {automaticCutout} from './backgroundRemoval';

export type ImagePreviewMode = 'thumb' | 'display' | 'cutout-thumb' | 'cutout-display';
const previews = new Map<string, Buffer>();
let cachedBytes = 0;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;

async function ordinary(bytes:Buffer,max:number,thumb:boolean){return sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate().resize({width:max,height:max,fit:'inside',withoutEnlargement:true}).webp({quality:thumb?72:82}).toBuffer();}
export async function imagePreview(bytes: Buffer, mimeType: string, mode: ImagePreviewMode): Promise<Buffer> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mimeType)) fail('INVALID_IMAGE', '此附件不能生成图片预览', 415);
  const key = mode + ':' + createHash('sha256').update(bytes).digest('hex'),cached=previews.get(key);if(cached)return cached;
  let result:Buffer;
  try {
    const thumb=mode.endsWith('thumb'),max=thumb?160:960,cutout=mode.startsWith('cutout-')?await automaticCutout(bytes):undefined;
    result=cutout?await sharp(cutout).trim({background:{r:0,g:0,b:0,alpha:0},threshold:3}).resize({width:max,height:max,fit:'inside',withoutEnlargement:true}).webp({quality:thumb?78:88}).toBuffer():await ordinary(bytes,max,thumb);
  } catch { return fail('INVALID_IMAGE', '图片无法预览，请下载原文件核对', 415); }
  while(cachedBytes+result.length>MAX_CACHE_BYTES&&previews.size){const first=previews.keys().next().value!;cachedBytes-=previews.get(first)!.length;previews.delete(first);}
  if(result.length<=MAX_CACHE_BYTES){previews.set(key,result);cachedBytes+=result.length;}return result;
}
