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
it('removes an edge-connected studio background while keeping the product opaque',async()=>{
 const width=240,height=180,raw=Buffer.alloc(width*height*3,248);
 for(let y=30;y<160;y++)for(let x=70;x<175;x++){const i=(y*width+x)*3;raw[i]=95;raw[i+1]=28;raw[i+2]=36;}
 const original=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer();
 const result=await imagePreview(original,'image/png','cutout-display'),decoded=await sharp(result).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 expect(decoded.info.width).toBeLessThanOrEqual(960);expect(decoded.info.width/decoded.info.height).toBeLessThan(1);
 const center=(Math.floor(decoded.info.height/2)*decoded.info.width+Math.floor(decoded.info.width/2))*4;expect(decoded.data[center+3]).toBeGreaterThan(240);
});
it('falls back to an opaque preview for a non-uniform scene edge',async()=>{
 const width=120,height=120,raw=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3,v=(x+y)%2?20:230;raw[i]=v;raw[i+1]=90;raw[i+2]=180;}
 const original=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer(),result=await imagePreview(original,'image/png','cutout-thumb');
 expect((await sharp(result).metadata()).hasAlpha).toBe(false);
});
