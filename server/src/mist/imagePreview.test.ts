import {expect,it} from 'vitest';
import sharp from 'sharp';
import {imagePreview} from './imagePreview';
import {applyAlphaMatte} from './backgroundRemoval';
it('reduces large source images without changing their original bytes',async()=>{
 const original=await sharp({create:{width:2400,height:1600,channels:3,background:'#9ca5af'}}).png().toBuffer(),copy=Buffer.from(original);
 for(const [mode,max] of [['thumb',160],['display',960]] as const){const result=await imagePreview(original,'image/png',mode);const metadata=await sharp(result).metadata();expect(metadata.format).toBe('webp');expect(metadata.width).toBeLessThanOrEqual(max);expect(result.length).toBeLessThan(original.length);}
 expect(original).toEqual(copy);
});
it('rejects unsupported and malformed image files',async()=>{
 await expect(imagePreview(Buffer.from('pdf'),'application/pdf','thumb')).rejects.toMatchObject({code:'INVALID_IMAGE'});
 await expect(imagePreview(Buffer.from('invalid'),'image/png','thumb')).rejects.toMatchObject({code:'INVALID_IMAGE'});
});
it('applies a continuous alpha matte without cutting a jagged binary edge',async()=>{
 const width=120,height=80,original=await sharp({create:{width,height,channels:3,background:'#7a1f2b'}}).png().toBuffer(),mask=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)mask[y*width+x]=x<30?0:x>50?255:Math.round((x-30)/20*255);
 const result=await applyAlphaMatte(original,mask,width,height),decoded=await sharp(result!).ensureAlpha().raw().toBuffer({resolveWithObject:true}),middle=(40*decoded.info.width+40)*4;
 expect(decoded.data[3]).toBe(0);expect(decoded.data[middle+3]).toBeGreaterThan(80);expect(decoded.data[middle+3]).toBeLessThan(220);expect(decoded.data.at(-1)).toBe(255);
});
it('falls back to the opaque preview when no private model is configured',async()=>{
 const original=await sharp({create:{width:120,height:120,channels:3,background:'#345678'}}).png().toBuffer(),result=await imagePreview(original,'image/png','cutout-thumb');
 expect((await sharp(result).metadata()).hasAlpha).toBe(false);
});
