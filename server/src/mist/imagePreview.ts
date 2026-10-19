import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {fail} from './errors';

export type ImagePreviewMode = 'thumb' | 'display' | 'cutout-thumb' | 'cutout-display';

// Bounded process cache contains only derivatives; authorization runs before every call.
const previews = new Map<string, Buffer>();
let cachedBytes = 0;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
function median(values:number[]){const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??0;}
function distance(data:Buffer,index:number,bg:[number,number,number]){const r=data[index]-bg[0],g=data[index+1]-bg[1],b=data[index+2]-bg[2];return Math.sqrt(r*r+g*g+b*b);}
async function productCutout(bytes:Buffer,max:number):Promise<Buffer|undefined>{
  const source=await sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate().resize({width:Math.max(max,1200),height:Math.max(max,1200),fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=source.info,data=source.data;if(channels!==4||width<8||height<8)return undefined;
  const border:number[]=[];const add=(x:number,y:number)=>{const i=(y*width+x)*4;border.push(i);};
  const step=Math.max(1,Math.floor(Math.min(width,height)/120));
  for(let x=0;x<width;x+=step){add(x,0);add(x,height-1);}for(let y=step;y<height-1;y+=step){add(0,y);add(width-1,y);}
  const transparent=border.filter(i=>data[i+3]<230).length/border.length;
  if(transparent>.25)return sharp(data,{raw:{width,height,channels:4}}).trim({background:{r:0,g:0,b:0,alpha:0},threshold:6}).resize({width:max,height:max,fit:'inside',withoutEnlargement:true}).webp({quality:max<=160?76:86}).toBuffer();
  const bg:[number,number,number]=[median(border.map(i=>data[i])),median(border.map(i=>data[i+1])),median(border.map(i=>data[i+2]))];
  const edgeDistances=border.map(i=>distance(data,i,bg)).sort((a,b)=>a-b),p80=edgeDistances[Math.floor(edgeDistances.length*.8)]??Infinity;
  if(p80>34)return undefined;
  const threshold=Math.max(92,Math.min(140,p80+105)),count=width*height,seen=new Uint8Array(count),queue=new Int32Array(count);let head=0,tail=0;
  const variation=(p:number)=>{const x=p%width,y=Math.floor(p/width),i=p*4;let value=0;for(const other of [x?p-1:-1,x+1<width?p+1:-1,y?p-width:-1,y+1<height?p+width:-1])if(other>=0){const j=other*4,dr=data[i]-data[j],dg=data[i+1]-data[j+1],db=data[i+2]-data[j+2];value=Math.max(value,Math.sqrt(dr*dr+dg*dg+db*db));}return value;};
  const push=(x:number,y:number)=>{const p=y*width+x;if(seen[p])return;const delta=distance(data,p*4,bg);if(delta>threshold||(delta>45&&variation(p)>14))return;seen[p]=1;queue[tail++]=p;};
  for(let x=0;x<width;x++){push(x,0);push(x,height-1);}for(let y=1;y<height-1;y++){push(0,y);push(width-1,y);}
  while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);if(x)push(x-1,y);if(x+1<width)push(x+1,y);if(y)push(x,y-1);if(y+1<height)push(x,y+1);}
  const coverage=tail/count;if(coverage<.04||coverage>.94)return undefined;
  const output=Buffer.from(data),soft=Math.max(18,threshold*.32);
  for(let p=0;p<count;p++){
    const i=p*4;if(seen[p]){output[i+3]=0;continue;}
    const x=p%width,y=Math.floor(p/width),near=(x&&seen[p-1])||(x+1<width&&seen[p+1])||(y&&seen[p-width])||(y+1<height&&seen[p+width]);
    if(near){const alpha=Math.max(0,Math.min(1,(distance(data,i,bg)-soft)/(threshold-soft)));output[i+3]=Math.round(output[i+3]*alpha);}
  }
  for(let p=0;p<count;p++){const i=p*4,a=output[i+3];output[i+3]=a<64?0:a<224?Math.round((a-64)/160*255):255;}
  return sharp(output,{raw:{width,height,channels:4}}).trim({background:{r:0,g:0,b:0,alpha:0},threshold:6}).resize({width:max,height:max,fit:'inside',withoutEnlargement:true}).webp({quality:max<=160?76:86}).toBuffer();
}
export async function imagePreview(bytes: Buffer, mimeType: string, mode: ImagePreviewMode): Promise<Buffer> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mimeType)) fail('INVALID_IMAGE', '此附件不能生成图片预览', 415);
  const key = mode + ':' + createHash('sha256').update(bytes).digest('hex');
  const cached = previews.get(key);
  if (cached) return cached;
  let result: Buffer;
  try {
    const thumb=mode.endsWith('thumb'),max=thumb?160:960;
    result = mode.startsWith('cutout-') ? await productCutout(bytes,max) ?? await sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate().resize({width:max,height:max,fit:'inside',withoutEnlargement:true}).webp({quality:thumb?72:82}).toBuffer()
      : await sharp(bytes, {limitInputPixels: 40_000_000, animated: false}).rotate().resize({width:max,height:max,fit:'inside',withoutEnlargement:true}).webp({quality:thumb?72:82}).toBuffer();
  } catch { return fail('INVALID_IMAGE', '图片无法预览，请下载原文件核对', 415); }
  while (cachedBytes + result.length > MAX_CACHE_BYTES && previews.size) {
    const first = previews.keys().next().value!; cachedBytes -= previews.get(first)!.length; previews.delete(first);
  }
  if (result.length <= MAX_CACHE_BYTES) { previews.set(key, result); cachedBytes += result.length; }
  return result;
}
