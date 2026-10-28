import { createHash } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { generateAvatar } from './avatarPresets';
import { mistPalette,mistSchemeHues } from './avatarColor';

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
