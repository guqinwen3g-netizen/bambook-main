import {expect,it} from 'vitest';
import {refineAlphaMatte} from './alphaRefine';

function scene(width:number,height:number,paint:(x:number,y:number)=>{rgb:[number,number,number];alpha:number}){
 const rgba=Buffer.alloc(width*height*4),mask=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,{rgb,alpha}=paint(x,y);rgba[p*4]=rgb[0];rgba[p*4+1]=rgb[1];rgba[p*4+2]=rgb[2];rgba[p*4+3]=255;mask[p]=Math.round(alpha*255);}
 return {rgba,mask};
}
const at=(data:Buffer,width:number,x:number,y:number)=>Array.from(data.subarray((y*width+x)*4,(y*width+x)*4+4));
const BG:[number,number,number]=[214,214,210],BLUE:[number,number,number]=[32,80,160],WHITE:[number,number,number]=[250,250,248];

it('clears a detached background haze while keeping the subject opaque',()=>{
 const width=300,height=200,{rgba,mask}=scene(width,height,(x,y)=>x>=40&&x<140&&y>=50&&y<150?{rgb:BLUE,alpha:1}:x>=220&&x<270&&y>=60&&y<110?{rgb:BG,alpha:.3}:{rgb:BG,alpha:0});
 const out=refineAlphaMatte(rgba,mask,width,height).data;
 expect(at(out,width,245,85)[3]).toBe(0);expect(at(out,width,90,100)[3]).toBe(255);
});

it('lowers background-coloured haze attached to the subject edge',()=>{
 const width=1000,height=200,{rgba,mask}=scene(width,height,(x,y)=>x>=100&&x<200&&y>=50&&y<150?{rgb:BLUE,alpha:1}:x>=88&&x<212&&y>=38&&y<162?{rgb:BG,alpha:.3}:{rgb:BG,alpha:0});
 const out=refineAlphaMatte(rgba,mask,width,height).data;
 expect(at(out,width,93,100)[3]).toBeLessThan(25);expect(at(out,width,150,100)[3]).toBe(255);
});

it('fills a white-on-white garment interior the model left semi-transparent',()=>{
 const width=400,height=400,{rgba,mask}=scene(width,height,(x,y)=>{const inside=x>=40&&x<360&&y>=40&&y<360,core=x>=110&&x<290&&y>=110&&y<290;return {rgb:inside?WHITE:BG,alpha:core?.55:inside?1:0};});
 const out=refineAlphaMatte(rgba,mask,width,height).data;
 expect(at(out,width,200,200)[3]).toBeGreaterThan(240);expect(at(out,width,10,10)[3]).toBe(0);
});

it('removes the dark background tint from semi-transparent edge pixels',()=>{
 const width=1000,height=120,dark:[number,number,number]=[70,70,74],{rgba,mask}=scene(width,height,x=>{const a=x<140?0:x>=150?1:(x-140)/10;return {rgb:[0,1,2].map(c=>Math.round(a*WHITE[c]+(1-a)*dark[c])) as [number,number,number],alpha:a};});
 const out=refineAlphaMatte(rgba,mask,width,height).data,edge=at(out,width,146,60);
 expect(edge[3]).toBeGreaterThan(90);expect(edge[3]).toBeLessThan(200);expect(edge[0]).toBeGreaterThan(at(rgba,width,146,60)[0]+40);
});
