import { createHash } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { generateAvatar } from './avatarPresets';
import { mistPalette,mistSchemeHues } from './avatarColor';

it('separates simple character body hues from their backgrounds without changing their features',async()=>{
 const {AVATAR_COLORS}=await import('../server/src/shared/avatarAppearance');
 const hue=(hex:string)=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return 0;return ((max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360;};
 const decode=(src:string)=>decodeURIComponent(src.split(',')[1]).toLowerCase();
 for(const color of AVATAR_COLORS)for(const family of ['gaze','thumbs']){
  const old=decode(generateAvatar(family,`p${color.id}_v12_12_12_character-0`,false));
  const svg=decode(generateAvatar(family,`p${color.id}_v13_12_12_character-0`,false));
  const colors=Array.from(new Set(svg.match(/#[0-9a-f]{6}\b/g)||[]));
  const body=colors.filter(hex=>![color.value.toLowerCase(),'#25313a','#fffdf8'].includes(hex));
  expect(body).toHaveLength(1);
  expect(Math.abs(((hue(body[0])-hue(color.value)+540)%360)-180)).toBeGreaterThan(45);
  expect(svg).toContain('#25313a');
  expect(svg.replace(/#[0-9a-f]{6}\b/g,'#color')).toBe(old.replace(/#[0-9a-f]{6}\b/g,'#color'));
 }
 for(const family of ['dylan','cameo','critters','weave']){
  expect(generateAvatar(family,'pblue_v13_12_12_character-0',false)).toBe(generateAvatar(family,'pblue_v12_12_12_character-0',false));
 }
});

it('keeps eyes neutral and human features natural across background colors',async()=>{
 const {AVATAR_COLORS}=await import('../server/src/shared/avatarAppearance');
 let firstPortraitFeatures:string[]|undefined;let sawHighlight=false;
 for(const color of AVATAR_COLORS){
  const render=(family:string)=>decodeURIComponent(generateAvatar(family,`p${color.id}_v12_12_12_features-0`,false).split(',')[1]).toLowerCase();
  for(let i=0;i<6;i++){
   const gaze=decodeURIComponent(generateAvatar('gaze',`p${color.id}_v12_12_12_eyes${i}-0`,false).split(',')[1]).toLowerCase();
   const eye=gaze.match(/<g class="dbga-eye">([\s\S]*?)<\/g>/)?.[1];
   expect(eye).toBeTruthy();
   const eyeColors=eye!.match(/#[0-9a-f]{6}/g)||[];
   expect(eyeColors.length).toBeGreaterThan(0);
   expect(eyeColors.every(value=>['#25313a','#fffdf8'].includes(value))).toBe(true);
   sawHighlight ||= eyeColors.includes('#fffdf8');
  }
  const portrait=render('dylan');
  const features=Array.from(new Set(portrait.match(/#(?:e8b99b|d7a17f|bf8667|2c2927|4a3328|695246)\b/g)||[])).sort();
  expect(features.some(value=>['#e8b99b','#d7a17f','#bf8667'].includes(value))).toBe(true);
  expect(features.some(value=>['#2c2927','#4a3328','#695246'].includes(value))).toBe(true);
  if(firstPortraitFeatures)expect(features).toEqual(firstPortraitFeatures);else firstPortraitFeatures=features;
 }
 expect(sawHighlight).toBe(true);
});

describe('pattern avatar versions',()=>{
 it('preserves previously saved v5/v6 artwork even after rendering a newer color version',()=>{
  const inputs=[
   ['glass','c205_v6_12_12_example-0',false,'7e3a87ff7270fe6186036d66e33938171e88eba22484fc52d58e0a7356a671a1'],
   ['line-face','c72_v6_13_10_example-0',false,'0e3a8bec2693435fa2ecedbd5c1ec8b2660c8e7133e8b5eb4cd713f533f38c95'],
   ['waves','c205_v5_10_11_example-0',true,'fd5b9da3e456238f6a8bc910f78630baf20af0c00a10fdbb82c74d39e9e95f21'],
  ] as const;
  for(const [family,seed,animated,expected] of inputs){generateAvatar(family,seed.replace('_v6_','_v7_'),animated);expect(createHash('sha256').update(generateAvatar(family,seed,animated)).digest('hex')).toBe(expected);}
 });
 it('uses identical drawing geometry with slightly deeper colors for v7',()=>{
  for(const family of ['glass','weave']){
   const old=decodeURIComponent(generateAvatar(family,'c205_v6_12_12_example-0',false).split(',')[1]);
   const newer=decodeURIComponent(generateAvatar(family,'c205_v7_12_12_example-0',false).split(',')[1]);
   const mask=(svg:string)=>svg.replace(/#[0-9a-f]{8}(?![0-9a-f])|#[0-9a-f]{6}(?![0-9a-f])|#[0-9a-f]{3}(?![0-9a-f])/gi,'#COLOR');
   expect(newer).not.toBe(old);expect(mask(newer)).toBe(mask(old));
  }
 });
 it('uses evenly spaced hues and deepens every tone without changing older palette output',()=>{
  expect(mistSchemeHues).toEqual([0,36,72,108,144,180,216,252,288,324]);
  const brightness=(hex:string)=>[1,3,5].reduce((sum,i)=>sum+parseInt(hex.slice(i,i+2),16),0);
  for(const hue of mistSchemeHues)for(let i=0;i<5;i++)expect(brightness(mistPalette(hue,-5)[i])).toBeLessThan(brightness(mistPalette(hue)[i]));
 });
});

it('assigns color roles according to the drawing rather than randomizing every layer',async()=>{
 const {AVATAR_COLORS}=await import('../server/src/shared/avatarAppearance');
 for(const color of AVATAR_COLORS){
  for(const family of ['glyphs','glass','waves','weave','critters','thumbs','line-face','slice','cameo','landscape','disco','stripes']){
   const svg=decodeURIComponent(generateAvatar(family,`p${color.id}_v11_12_12_shared-0`,false).split(',')[1]);
   expect(svg).toContain(`data-bambook-background="${color.id}"`);
  }
  const woven=decodeURIComponent(generateAvatar('weave',`p${color.id}_v11_12_12_shared-0`,false).split(',')[1]).toLowerCase();
  const another=decodeURIComponent(generateAvatar('weave',`p${color.id}_v11_12_12_other-0`,false).split(',')[1]).toLowerCase();
  const fills=(svg:string)=>new Set((svg.match(/#[0-9a-f]{6}(?![0-9a-f])/g)||[]));
  expect(fills(woven)).toEqual(fills(another));
 }
});

it('uses a coordinated artwork palette with the selected background in new pattern previews',async()=>{
 const {AVATAR_COLORS}=await import('../server/src/shared/avatarAppearance');
 const accents:Record<string,string[]>={blue:['#4c7098','#c87972','#6d8f80'],indigo:['#7166a0','#c78070','#6d907f'],plum:['#8e6385','#69948d','#c58a68'],rose:['#a36070','#608d88','#ad805b'],clay:['#a86756','#5d8f8b','#a78550'],ochre:['#927046','#628c88','#a86f76'],sage:['#788149','#ad7467','#658c95'],forest:['#5b8667','#ad7772','#7c7fa9'],teal:['#558c83','#ba7a70','#8f78a0'],slate:['#5e8798','#c78372','#87956a']};
 for(const color of AVATAR_COLORS){
  const svg=decodeURIComponent(generateAvatar('weave',`p${color.id}_v10_12_12_shared-0`,false).split(',')[1]);
  expect(svg).toContain(`data-bambook-background="${color.id}"`);
  expect(svg.toLowerCase()).toContain(`fill="${color.value.toLowerCase()}"`);
  expect(accents[color.id].filter(accent=>svg.toLowerCase().includes(accent)).length).toBeGreaterThanOrEqual(2);
 }
});

it('writes the exact shared palette background into every explored style while retaining attribution metadata',async()=>{
 const {AVATAR_COLORS}=await import('../server/src/shared/avatarAppearance');
 for(const color of AVATAR_COLORS)for(const family of ['glyphs','glass','waves','weave','dylan','line-face','critters','thumbs','gaze','slice','stripes','cameo']){
  const svg=decodeURIComponent(generateAvatar(family,`p${color.id}_v8_12_12_shared-0`,false).split(',')[1]);
  expect(svg).toContain(`data-bambook-background="${color.id}"`);expect(svg.toLowerCase()).toContain(`fill="${color.value.toLowerCase()}"`);
  expect(svg).toContain('<metadata');
  if(family==='glyphs')expect(svg).not.toMatch(/<path fill="white" d="M0 0h72v72H0z"\/><path opacity="\.2"/);
 }
});

it('retains the selected background and introduces distinct artwork colors for new patterns',async()=>{
 const {AVATAR_COLORS}=await import('../server/src/shared/avatarAppearance');
 for(const color of AVATAR_COLORS){let changed=0;for(const family of ['glyphs','glass','waves','weave','slice']){
  const svg=decodeURIComponent(generateAvatar(family,`p${color.id}_v9_12_12_shared-0`,false).split(',')[1]);
  expect(svg).toContain(`data-bambook-background="${color.id}"`);
  expect(svg.toLowerCase()).toContain(`fill="${color.value.toLowerCase()}"`);
  const old=generateAvatar(family,`p${color.id}_v8_12_12_shared-0`,false);
  if(generateAvatar(family,`p${color.id}_v9_12_12_shared-0`,false)!==old)changed++;
  // Some original motifs only contain one shape; it must remain visible on the background.
  expect(new Set((svg.match(/#[0-9a-f]{6}(?![0-9a-f])/gi)||[]).map(v=>v.toLowerCase())).size).toBeGreaterThanOrEqual(2);
 }expect(changed).toBeGreaterThan(0);}
});
