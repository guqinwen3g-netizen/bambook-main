import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {fail} from './errors';

// Bounded process cache contains only derivatives; authorization runs before every call.
const previews = new Map<string, Buffer>();
let cachedBytes = 0;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
export async function imagePreview(bytes: Buffer, mimeType: string, mode: 'thumb' | 'display'): Promise<Buffer> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mimeType)) fail('INVALID_IMAGE', '此附件不能生成图片预览', 415);
  const key = mode + ':' + createHash('sha256').update(bytes).digest('hex');
  const cached = previews.get(key);
  if (cached) return cached;
  let result: Buffer;
  try {
    result = await sharp(bytes, {limitInputPixels: 40_000_000, animated: false})
      .rotate().resize({width: mode === 'thumb' ? 160 : 960, height: mode === 'thumb' ? 160 : 960, fit: 'inside', withoutEnlargement: true})
      .webp({quality: mode === 'thumb' ? 72 : 82}).toBuffer();
  } catch { return fail('INVALID_IMAGE', '图片无法预览，请下载原文件核对', 415); }
  while (cachedBytes + result.length > MAX_CACHE_BYTES && previews.size) {
    const first = previews.keys().next().value!; cachedBytes -= previews.get(first)!.length; previews.delete(first);
  }
  if (result.length <= MAX_CACHE_BYTES) { previews.set(key, result); cachedBytes += result.length; }
  return result;
}
