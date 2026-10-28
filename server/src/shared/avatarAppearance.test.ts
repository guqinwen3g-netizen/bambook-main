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
