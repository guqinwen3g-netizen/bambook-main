import { describe,expect,it } from 'vitest';
import { AVATAR_COLORS, defaultAvatarColor, defaultPersonAvatar, initialsIdentity, isAvatarIdentity, parseInitialsIdentity, parsePersonIdentity, personIdentity } from './avatarAppearance';

describe('versioned avatar choices',()=>{
 it('retains each editable part through a save/reload round trip',()=>{
  const original={...defaultPersonAvatar('account-7'),hair:'bun' as const,backHair:'longStraight' as const,mouth:'laugh' as const};
  expect(parsePersonIdentity(personIdentity(original))).toEqual(original);
  expect(isAvatarIdentity(personIdentity(original))).toBe(true);
 });
 it.each([{hair:'external-svg'}, {background:'url(https://example.com)'}, {seed:'<script>'}, {unknown:'value'}, {eyes:[]}, {skin:'#FFFFFF'}])('rejects unexpected or malformed fields: %j',patch=>{
  const raw='person:v1:'+encodeURIComponent(JSON.stringify({...defaultPersonAvatar(),...patch}));
  expect(parsePersonIdentity(raw)).toBeNull();expect(isAvatarIdentity(raw)).toBe(false);
 });
 it('rejects broken and oversized encodings without throwing',()=>{
  for(const value of ['person:v1:%XX','person:v1:'+ 'a'.repeat(3000),'person:v1:null','person:v1:%7B%7D'])expect(parsePersonIdentity(value)).toBeNull();
 });
 it('uses a stable identity color and validates explicit colors',()=>{
  expect(defaultAvatarColor('account-7')).toBe(defaultAvatarColor('account-7'));
  for(const color of AVATAR_COLORS)expect(parseInitialsIdentity(initialsIdentity(color.id))).toBe(color.id);
  expect(isAvatarIdentity('initials:v1:unknown')).toBe(false);
 });
 it('spreads ten muted background colors evenly around the perceptual hue wheel',()=>{
  const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  const perceptual=(hex:string)=>{const [r,g,b]=[1,3,5].map(i=>linear(parseInt(hex.slice(i,i+2),16)/255));
    const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
    const a=1.9779984951*l-2.428592205*m+.4505937099*s,bb=.0259040371*l+.7827717662*m-.808675766*s;
    return {hue:(Math.atan2(bb,a)*180/Math.PI+360)%360, lightness:.2104542553*l+.793617785*m-.0040720468*s, chroma:Math.hypot(a,bb)};};
  const colors=AVATAR_COLORS.map(color=>perceptual(color.value));
  const angles=colors.map(color=>color.hue).sort((a,b)=>a-b);
  expect(Math.max(...colors.map(color=>color.lightness))-Math.min(...colors.map(color=>color.lightness))).toBeLessThan(.008);
  expect(Math.max(...colors.map(color=>color.chroma))-Math.min(...colors.map(color=>color.chroma))).toBeLessThan(.008);
  expect(angles).toHaveLength(10);
  for(let i=0;i<angles.length;i++){const next=angles[(i+1)%angles.length]+(i===angles.length-1?360:0);expect(next-angles[i]).toBeGreaterThan(32);expect(next-angles[i]).toBeLessThan(40);}
 });
 it('distributes representative account IDs across all ten colors',()=>{
  const counts=new Map(AVATAR_COLORS.map(color=>[color.id,0]));
  for(let index=0;index<10000;index++){const id=defaultAvatarColor(`user-${index}`);counts.set(id,counts.get(id)!+1);}
  for(const count of counts.values()){expect(count).toBeGreaterThan(850);expect(count).toBeLessThan(1150);}
 });
 it('keeps legacy generated avatars valid',()=>{
  expect(isAvatarIdentity('dicebear:v1:glass:c205_v6_12_12_abc-0:animated')).toBe(true);
  expect(isAvatarIdentity('javascript:alert(1)')).toBe(false);
 });
 it('keeps tonal initials readable on every mist background',()=>{
  const linear=(x:number)=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
  const luminance=(hex:string)=>{const rgb=[1,3,5].map(i=>linear(parseInt(hex.slice(i,i+2),16)/255));return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
  for(const {value,ink} of AVATAR_COLORS){const bg=luminance(value),fg=luminance(ink);expect((Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05),value).toBeGreaterThanOrEqual(4.5);}

 });
});
it('accepts only known shared palette IDs in the new pattern identity',()=>{
 expect(isAvatarIdentity('dicebear:v1:glass:pblue_v8_12_12_test-0:still')).toBe(true);
 expect(isAvatarIdentity('dicebear:v1:glass:pblue_v9_12_12_test-0:still')).toBe(true);
 expect(isAvatarIdentity('dicebear:v1:glass:pblue_v10_12_12_test-0:still')).toBe(true);
 expect(isAvatarIdentity('dicebear:v1:glass:pblue_v11_12_12_test-0:still')).toBe(true);
 expect(isAvatarIdentity('dicebear:v1:glass:pblue_v12_12_12_test-0:still')).toBe(true);
 expect(isAvatarIdentity('dicebear:v1:gaze:pblue_v13_12_12_test-0:still')).toBe(true);
 expect(isAvatarIdentity('dicebear:v1:glass:punknown_v8_12_12_test-0:still')).toBe(false);
 expect(isAvatarIdentity('dicebear:v1:glass:punknown_v9_12_12_test-0:still')).toBe(false);
 expect(isAvatarIdentity('dicebear:v1:glass:punknown_v10_12_12_test-0:still')).toBe(false);
 expect(isAvatarIdentity('dicebear:v1:glass:punknown_v11_12_12_test-0:still')).toBe(false);
 expect(isAvatarIdentity('dicebear:v1:glass:punknown_v12_12_12_test-0:still')).toBe(false);
 expect(isAvatarIdentity('dicebear:v1:gaze:punknown_v13_12_12_test-0:still')).toBe(false);
});
