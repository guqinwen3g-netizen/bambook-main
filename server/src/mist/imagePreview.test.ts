import {expect,it} from 'vitest';
import sharp from 'sharp';
import {imagePreview} from './imagePreview';
it('reduces large source images without changing their original bytes',async()=>{
 const original=await sharp({create:{width:2400,height:1600,channels:3,background:'#9ca5af'}}).png().toBuffer(),copy=Buffer.from(original);
 for(const [mode,max] of [['thumb',160],['display',960]] as const){const result=await imagePreview(original,'image/png',mode);const metadata=await sharp(result).metadata();expect(metadata.format).toBe('webp');expect(metadata.width).toBeLessThanOrEqual(max);expect(result.length).toBeLessThan(original.length);}
 expect(original).toEqual(copy);
});
it('rejects unsupported and malformed image files',async()=>{
 await expect(imagePreview(Buffer.from('pdf'),'application/pdf','thumb')).rejects.toMatchObject({code:'INVALID_IMAGE'});
 await expect(imagePreview(Buffer.from('invalid'),'image/png','thumb')).rejects.toMatchObject({code:'INVALID_IMAGE'});
});
