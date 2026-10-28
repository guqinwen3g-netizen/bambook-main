/** Versioned, data-only avatar choices. Shared by profile validation and the renderer. */
export const AVATAR_COLORS = [
  { id: 'blue', label: '雾蓝', value: '#C6DAE3', ink: '#465668' },
  { id: 'teal', label: '青绿', value: '#C2DBD6', ink: '#385D58' },
  { id: 'forest', label: '松绿', value: '#D3DFD1', ink: '#4D5F4B' },
  { id: 'clay', label: '赤陶', value: '#E5D5CA', ink: '#6A554A' },
  { id: 'rose', label: '莓红', value: '#E5D2D7', ink: '#68505A' },
  { id: 'indigo', label: '靛青', value: '#DCD5E7', ink: '#5D526E' },
  { id: 'ochre', label: '赭金', value: '#E5DCCB', ink: '#655B49' },
  { id: 'slate', label: '石青', value: '#D0DADC', ink: '#4D6065' },
] as const;
export type AvatarColor = typeof AVATAR_COLORS[number]['id'];
export function defaultAvatarColor(key: string): AvatarColor {
  let hash = 2166136261;
  for (const char of key.normalize('NFC').trim()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length].id;
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
export const isAvatarIdentity = (value: string) => LEGACY_AVATAR_PATTERN.test(value) || !!parseInitialsIdentity(value) || !!parsePersonIdentity(value);
