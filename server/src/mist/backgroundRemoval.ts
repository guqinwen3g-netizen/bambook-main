import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import sharp from 'sharp';

type Ort=typeof import('onnxruntime-node');
type Session=import('onnxruntime-node').InferenceSession;
const SIZE=1024,MEAN=[.485,.456,.406],STD=[.229,.224,.225];
let sessionPromise:Promise<Session|undefined>|undefined,inferenceTail=Promise.resolve(),warned=false;
const results=new Map<string,Promise<Buffer|undefined>>();

async function sha256(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk as Buffer);return hash.digest('hex');}
async function session(){
 if(sessionPromise)return sessionPromise;
 sessionPromise=(async()=>{
  const path=process.env.BAMBOOK_BACKGROUND_REMOVAL_MODEL?.trim();if(!path)return undefined;
  const info=await stat(path);if(!info.isFile()||info.size<1024*1024)throw new Error('背景移除模型文件无效');
  const expected=process.env.BAMBOOK_BACKGROUND_REMOVAL_MODEL_SHA256?.trim().toLowerCase();if(expected&&await sha256(path)!==expected)throw new Error('背景移除模型摘要不匹配');
  const ort:Ort=await import('onnxruntime-node');return ort.InferenceSession.create(path,{executionProviders:['cpu']});
 })().catch(error=>{if(!warned){warned=true;console.error('[image-cutout] model unavailable:',error instanceof Error?error.message:String(error));}return undefined;});
 return sessionPromise;
}
function modelType(){return process.env.BAMBOOK_BACKGROUND_REMOVAL_MODEL_TYPE==='isnet'?'isnet':'birefnet';}
export function imageCutoutVersion(){const value=process.env.BAMBOOK_BACKGROUND_REMOVAL_MODEL_VERSION?.trim();return value&&/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)?value:'unconfigured-v1';}
function serial<T>(run:()=>Promise<T>):Promise<T>{const next=inferenceTail.then(run,run);inferenceTail=next.then(()=>undefined,()=>undefined);return next;}

export async function applyAlphaMatte(bytes:Buffer,mask:Uint8Array,maskWidth:number,maskHeight:number):Promise<Buffer|undefined>{
 const original=await sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const resized=await sharp(Buffer.from(mask),{raw:{width:maskWidth,height:maskHeight,channels:1}}).resize(original.info.width,original.info.height,{fit:'fill',kernel:'lanczos3'}).blur(.35).raw().toBuffer({resolveWithObject:true});
 const output=Buffer.from(original.data),count=original.info.width*original.info.height;let foreground=0;
 for(let p=0;p<count;p++){const alpha=Math.round(output[p*4+3]*resized.data[p*resized.info.channels]/255);output[p*4+3]=alpha;if(alpha>10)foreground++;}
 const coverage=foreground/count;if(coverage<.01||coverage>.98)return undefined;
 return sharp(output,{raw:{width:original.info.width,height:original.info.height,channels:4}}).png().toBuffer();
}
async function infer(bytes:Buffer):Promise<Buffer|undefined>{
 const active=await session();if(!active)return undefined;
 return serial(async()=>{
  const input=await sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate().resize(SIZE,SIZE,{fit:'fill'}).removeAlpha().raw().toBuffer();
  const data=new Float32Array(3*SIZE*SIZE),pixels=SIZE*SIZE;
  const kind=modelType();for(let p=0;p<pixels;p++)for(let c=0;c<3;c++)data[c*pixels+p]=kind==='isnet'?(input[p*3+c]-128)/256:(input[p*3+c]/255-MEAN[c])/STD[c];
  const ort:Ort=await import('onnxruntime-node'),outputs=await active.run({[kind==='isnet'?'input':'input_image']:new ort.Tensor('float32',data,[1,3,SIZE,SIZE])}),tensor=outputs[kind==='isnet'?'output':'output_image']??Object.values(outputs)[0];
  if(!tensor||tensor.data.length!==pixels)throw new Error('背景移除模型输出无效');
  const values=tensor.data as Float32Array,mask=new Uint8Array(pixels);let min=Infinity,max=-Infinity;if(kind==='isnet')for(let i=0;i<pixels;i++){min=Math.min(min,values[i]);max=Math.max(max,values[i]);}
  for(let i=0;i<pixels;i++){const value=Number(values[i]),alpha=kind==='isnet'?(value-min)/Math.max(1e-8,max-min):1/(1+Math.exp(-Math.max(-30,Math.min(30,value))));mask[i]=Math.round(255*Math.max(0,Math.min(1,alpha)));}
  return applyAlphaMatte(bytes,mask,SIZE,SIZE);
 });
}
export function automaticCutout(bytes:Buffer):Promise<Buffer|undefined>{
 const key=imageCutoutVersion()+':'+createHash('sha256').update(bytes).digest('hex');let value=results.get(key);if(!value){value=infer(bytes).catch(error=>{console.error('[image-cutout] inference failed:',error instanceof Error?error.message:String(error));return undefined;});results.set(key,value);while(results.size>8)results.delete(results.keys().next().value!);}return value;
}
