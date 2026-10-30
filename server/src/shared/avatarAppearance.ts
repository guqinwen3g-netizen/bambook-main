/** Versioned, data-only avatar choices. Shared by profile validation and the renderer. */
export const CHROMATIC_AVATAR_COLORS = [
  { id:'blue', hue:252, label:'雾蓝', value:'#B4D1F1', ink:'#304155' },
  { id:'indigo', hue:288, label:'雾紫', value:'#CBC9F1', ink:'#3E3D54' },
  { id:'plum', hue:324, label:'柔紫', value:'#E0C2E2', ink:'#4A394C' },
  { id:'rose', hue:0, label:'藕粉', value:'#EDBFCC', ink:'#52373F' },
  { id:'clay', hue:36, label:'浅陶', value:'#EFC2B5', ink:'#533831' },
  { id:'ochre', hue:72, label:'暖杏', value:'#E5C9A7', ink:'#4D3C28' },
  { id:'sage', hue:108, label:'新芽', value:'#D1D1A8', ink:'#424128' },
  { id:'forest', hue:144, label:'柔绿', value:'#B9D8B8', ink:'#334532' },
  { id:'teal', hue:180, label:'薄荷', value:'#A7DACF', ink:'#264740' },
  { id:'slate', hue:216, label:'雾青', value:'#A5D7E5', ink:'#25454D' },
] as const;
export const AVATAR_COLORS = [
  ...CHROMATIC_AVATAR_COLORS,
  { id:'pearl', hue:0, label:'柔白', value:'#F2F1ED', ink:'#454A50' },
  { id:'charcoal', hue:0, label:'炭灰', value:'#343B43', ink:'#F2F1ED' },
] as const;
export type AvatarColor = typeof AVATAR_COLORS[number]['id'];
// Retain the old ID for saved identities, but do not offer it to new choices.
export const SELECTABLE_AVATAR_COLORS = AVATAR_COLORS.filter(color => color.id !== 'ochre');
const AUTOMATIC_AVATAR_COLORS = CHROMATIC_AVATAR_COLORS.filter(color => color.id !== 'ochre');
export function defaultAvatarColor(key: string): AvatarColor {
  let hash = 2166136261;
  for (const char of key.normalize('NFC').trim()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  // Keep automatic initials stable when adding optional palette choices.
  const unsigned = hash >>> 0;
  const original = CHROMATIC_AVATAR_COLORS[unsigned % CHROMATIC_AVATAR_COLORS.length];
  return original.id === 'ochre' ? AUTOMATIC_AVATAR_COLORS[Math.floor(unsigned / CHROMATIC_AVATAR_COLORS.length) % AUTOMATIC_AVATAR_COLORS.length].id : original.id;
}
export function initialsIdentity(color: AvatarColor) { return `initials:v1:${color}`; }
export function parseInitialsIdentity(value?: string | null): AvatarColor | null {
  return AVATAR_COLORS.find(color => value === initialsIdentity(color.id))?.id ?? null;
}
export const PERSON_CHOICES = {
  hair: [['sideComed','侧分'],['undercut','自然短发'],['bun','束发'],['spiky','蓬松短发'],['none','无前发']],
  backHair: [['none','无后发'],['longStraight','长直发'],['longWavy','长卷发'],['neckHigh','齐颈'],['shoulderHigh','齐肩']],
  eyes: [['happy','自然'],['wide','明亮'],['humble','低垂'],['bow','闭目'],['wink','眨眼']],
  brows: [['neutral','平和'],['happy','舒展'],['raised','挑眉'],['sad','忧思'],['angry','严肃']],
  mouth: [['smile','浅笑'],['laugh','微笑'],['agape','张口'],['sad','低落'],['angry','抿嘴']],
  clothes: [['shirt','衬衫'],['tShirt','T 恤'],['openJacket','外套'],['turtleNeck','针织'],['dress','连衣裙']],
} as const;
export const PERSON_SKIN_COLORS = ['#F0D0B5','#EBC5A5','#D6B08E','#C68E7A','#A36B4F','#78513F'] as const;
export const PERSON_HAIR_COLORS = ['#252725','#3B302A','#5A4033','#785B44','#A58B69','#B9B7B0'] as const;
export const PERSON_CLOTHES_COLORS = ['#6E889A','#F0EDE6','#65776A','#C1A99B','#3E4B5E','#884E59','#323A3B','#AC8757'] as const;
export const PERSON_BACKGROUNDS = ['#E0E9E9','#E6E5DF','#DCE6E1','#E9E2DF','#DCE4EF','#EAE0E7','#E7E4D8','#E0E5E8'] as const;
type Choice<K extends keyof typeof PERSON_CHOICES> = typeof PERSON_CHOICES[K][number][0];
export type PersonAvatar = {
  seed: string; hair: Choice<'hair'>; backHair: Choice<'backHair'>; eyes: Choice<'eyes'>;
  brows: Choice<'brows'>; mouth: Choice<'mouth'>; clothes: Choice<'clothes'>;
  skin: string; hairColor: string; clothesColor: string; background: string;
};
export function defaultPersonAvatar(seed = 'person'): PersonAvatar {
  return { seed: seed.replace(/[^A-Za-z0-9_-]/g,'').slice(0,64) || 'person', hair:'sideComed',backHair:'none',eyes:'happy',brows:'neutral',mouth:'smile',clothes:'shirt',skin:PERSON_SKIN_COLORS[1],hairColor:PERSON_HAIR_COLORS[0],clothesColor:PERSON_CLOTHES_COLORS[0],background:PERSON_BACKGROUNDS[0] };
}
function validPerson(value: unknown): value is PersonAvatar {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string,unknown>;
  const keys = Object.keys(defaultPersonAvatar());
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) return false;
  if (typeof row.seed !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.seed)) return false;
  for (const [key, choices] of Object.entries(PERSON_CHOICES)) if (!(choices as readonly (readonly [string,string])[]).some(([id]) => id === row[key])) return false;
  return ([['skin',PERSON_SKIN_COLORS],['hairColor',PERSON_HAIR_COLORS],['clothesColor',PERSON_CLOTHES_COLORS],['background',PERSON_BACKGROUNDS]] as const).every(([key,colors]) => colors.some(color => color === row[key]));
}
export function personIdentity(value: PersonAvatar): string {
  if (!validPerson(value)) throw new Error('人物头像配置无效');
  const stable = Object.fromEntries(Object.keys(defaultPersonAvatar()).map(key => [key, value[key as keyof PersonAvatar]]));
  return `person:v1:${encodeURIComponent(JSON.stringify(stable))}`;
}
export function parsePersonIdentity(value?: string | null): PersonAvatar | null {
  if (!value?.startsWith('person:v1:') || value.length > 2400) return null;
  try { const parsed: unknown = JSON.parse(decodeURIComponent(value.slice(10))); return validPerson(parsed) ? parsed : null; } catch { return null; }
}
export const LEGACY_AVATAR_PATTERN = /^dicebear:v1:(blobs|disco|glass|glyphs|squircles|slice|waves|weave|critters|cameo|line-face|thumbs|landscape|croodles-neutral|dylan|fun-emoji|gaze|pixelbot|rings|stripes|planets):([A-Za-z0-9_-]{1,80}):(animated|still)$/;
/** Shared pattern colors are stored by palette ID; older identities remain unchanged. */
export function patternColorFromSeed(seed:string): AvatarColor | null {
  const match=seed.match(/^p([a-z]+)_v(?:8|9|10|11|12|13|14)_(\d{1,2})_(\d{1,2})_([A-Za-z0-9_-]{1,48})-0$/);
  if(!match || Number(match[2])>24 || Number(match[3])>24)return null;
  return AVATAR_COLORS.find(color=>color.id===match[1])?.id ?? null;
}
export function patternColorFromIdentity(value?:string|null, includeLegacy=false): AvatarColor | null {
  const match=value?.match(LEGACY_AVATAR_PATTERN);if(!match)return null;
  const exact=patternColorFromSeed(match[2]);if(exact)return exact;
  if(!includeLegacy)return null;
  const legacy=match[2].match(/^c(\d{1,3})_v[567]_/);if(!legacy)return null;
  const hue=Number(legacy[1])%360;
  return CHROMATIC_AVATAR_COLORS.reduce((best,color)=>{
    const distance=(candidate:number)=>Math.abs(((candidate-hue+540)%360)-180);
    return distance(color.hue)<distance(best.hue)?color:best;
  }).id;
}
export function isAvatarIdentity(value:string) {
  const legacy=value.match(LEGACY_AVATAR_PATTERN);
  if(legacy) return !/^p[^_]*_v(?:8|9|10|11|12|13|14)(?:_|$)/.test(legacy[2]) || !!patternColorFromSeed(legacy[2]);
  return !!parseInitialsIdentity(value) || !!parsePersonIdentity(value);
}
