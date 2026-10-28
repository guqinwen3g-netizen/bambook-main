import { mistPalette } from './avatarColor';
import { AVATAR_COLORS, patternColorFromSeed } from '../server/src/shared/avatarAppearance';
import { avatarVariantPreferences } from './avatarVariantPreferences';
import { Avatar, Style } from '@dicebear/core';
import definition0 from '@dicebear/styles/blobs.json';
import definition1 from '@dicebear/styles/disco.json';
import definition2 from '@dicebear/styles/glass.json';
import definition3 from '@dicebear/styles/glyphs.json';
import definition4 from '@dicebear/styles/squircles.json';
import definition5 from '@dicebear/styles/slice.json';
import definition6 from '@dicebear/styles/waves.json';
import definition7 from '@dicebear/styles/weave.json';
import definition8 from '@dicebear/styles/critters.json';
import definition9 from '@dicebear/styles/cameo.json';
import definition10 from '@dicebear/styles/line-face.json';
import definition11 from '@dicebear/styles/thumbs.json';
import definition12 from '@dicebear/styles/landscape.json';

import additional0 from '@dicebear/styles/croodles-neutral.json';
import additional1 from '@dicebear/styles/dylan.json';
import additional2 from '@dicebear/styles/fun-emoji.json';
import additional3 from '@dicebear/styles/gaze.json';
import additional4 from '@dicebear/styles/pixelbot.json';
import additional5 from '@dicebear/styles/rings.json';
import additional6 from '@dicebear/styles/stripes.json';
import additional7 from '@dicebear/styles/planets.json';

// Avatar artwork palette: user-approved muted colors, independent of UI theme.
// Each avatar uses one coherent tonal family, selected deterministically by seed.
const palettes = [
  ['#ECF1F5', '#C6DAE3', '#A2B9C8', '#71869B', '#465668'], // mist blue
  ['#EFF2EE', '#D3DFD1', '#ADBFA9', '#80927C', '#4D5F4B'], // sage
  ['#F4EEEF', '#E5D2D7', '#C9A9B3', '#A07E89', '#68505A'], // dusty rose
  ['#F1EFF5', '#DCD5E7', '#BBB0CE', '#9385A8', '#5D526E'], // lavender gray
  ['#F4F1EB', '#E5DCCB', '#C9BBA1', '#A2947B', '#655B49'], // warm sand
  ['#F4EFEB', '#E5D5CA', '#CCB1A0', '#A88A79', '#6A554A'], // clay
] as const;

// Artwork accents are more vivid than the soft backgrounds, with varied hues.
const patternAccents = ['#6D8FC5','#8B80C5','#B57FB9','#D18191','#D58E74','#BE9A69','#A3A25F','#76A179','#5EA69A','#68A2B5'] as const;

// Curated combinations for the corresponding shared background. Each mixes
// a grounding tone with two complementary accents instead of random hues.
const coordinatedAccents: Record<string, readonly [string,string,string]> = {
  blue:['#4C7098','#C87972','#6D8F80'], indigo:['#7166A0','#C78070','#6D907F'],
  plum:['#8E6385','#69948D','#C58A68'], rose:['#A36070','#608D88','#AD805B'],
  clay:['#A86756','#5D8F8B','#A78550'], ochre:['#927046','#628C88','#A86F76'],
  sage:['#788149','#AD7467','#658C95'], forest:['#5B8667','#AD7772','#7C7FA9'],
  teal:['#558C83','#BA7A70','#8F78A0'], slate:['#5E8798','#C78372','#87956A'],
};

const paletteIndexFor = (seed: string) => {
  const explicit = seed.match(/^p([0-5])_/);
  if (explicit) return Number(explicit[1]);
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % palettes.length;
};
const definitions = {
  'blobs': definition0,
  'disco': definition1,
  'glass': definition2,
  'glyphs': definition3,
  'squircles': definition4,
  'slice': definition5,
  'waves': definition6,
  'weave': definition7,
  'critters': definition8,
  'cameo': definition9,
  'line-face': definition10,
  'thumbs': definition11,
  'landscape': definition12,
  'croodles-neutral': additional0,
  'dylan': additional1,
  'fun-emoji': additional2,
  'gaze': additional3,
  'pixelbot': additional4,
  'rings': additional5,
  'stripes': additional6,
  'planets': additional7
};

const styles = new Map<string, Style>();

export function generateAvatar(family: string, seed: string, animated = false): string {
  const paletteIndex = paletteIndexFor(seed);
  // v2 adds bounded tonal variety, while old saved seeds retain their exact artwork.
  let tone = 0;
  if (/^p[0-5]_v[23]_/.test(seed)) {
    let hash = 0;
    for (const character of seed.replace(/^p[0-5]_v3_\d+_\d+_/, "")) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    tone = ((hash >>> 0) % 7) - 3;
  }
  const hue = seed.match(/^c(\d{1,3})_v[567]_/);
  const deeper = /^c\d{1,3}_v7_/.test(seed);
  const sharedId=patternColorFromSeed(seed), shared=AVATAR_COLORS.find(color=>color.id===sharedId);
  if(/^p[^_]*_v(?:8|9|10|11|12|13)(?:_|$)/.test(seed) && !shared) throw new Error('未知的头像配色');
  const blend=(from:string,to:string,amount:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(from.slice(i,i+2),16)*(1-amount)+parseInt(to.slice(i,i+2),16)*amount).toString(16).padStart(2,'0')).join('');
  const colorful = !!shared && /^p[a-z]+_v9_/.test(seed);
  const distinctCharacter = !!shared && /^p[a-z]+_v13_/.test(seed);
  const naturalFeatures = !!shared && /^p[a-z]+_v(?:12|13)_/.test(seed);
  const familyColors = !!shared && /^p[a-z]+_v(?:11|12|13)_/.test(seed);
  const originalColors = !!shared && /^p[a-z]+_v(?:10|11|12|13)_/.test(seed);
  // New designs mix three contrasting families, while retaining the chosen background.
  const accents = shared && colorful ? [3,5,7].map(offset=>patternAccents[(AVATAR_COLORS.indexOf(shared)+offset)%patternAccents.length]) : [];
  const basePalette = shared ? originalColors ? [blend(shared.value,'#ffffff',.58),...coordinatedAccents[shared.id],shared.ink] : colorful ? [blend(shared.value,'#ffffff',.58),...accents,shared.ink] : [blend(shared.value,'#ffffff',.58),shared.value,blend(shared.value,shared.ink,.2),blend(shared.value,shared.ink,.45),shared.ink] : hue ? mistPalette(Number(hue[1]) % 360, deeper ? -5 : 0) : palettes[paletteIndex];
  const adjusted = basePalette.map((hex, index) => {
    if (!tone) return hex;
    const delta = tone * (index === 0 ? 1 : 3);
    return '#' + [1, 3, 5].map(offset => Math.max(0, Math.min(255, parseInt(hex.slice(offset, offset + 2), 16) + delta)).toString(16).padStart(2, '0')).join('');
  });
  const [frost, mist, middle, gray, ink] = adjusted;
  const colors = [gray, middle, mist];
  const cacheKey = `${family}:${hue ? `h${hue[1]}` : paletteIndex}:${tone}:${shared ? `v${distinctCharacter ? 13 : naturalFeatures ? 12 : familyColors ? 11 : originalColors ? 10 : colorful ? 9 : 8}-${shared.id}` : deeper ? 'v7' : 'legacy'}`;
  let style = styles.get(cacheKey);
  if (!style) {
    const definition = definitions[family as keyof typeof definitions];
    if (!definition) throw new Error('未知头像系列');
    const themedColors = Object.fromEntries(Object.entries(definition.colors).map(([name, color]) => {
      let values: string[] = colors;
      if (familyColors) {
        // Assign colors according to each drawing's structure, rather than
        // letting the renderer independently randomize related layers.
        const [primary,secondary,tertiary] = coordinatedAccents[shared!.id];
        const roles: Record<string, Record<string,string[]>> = {
          weave: { colorA:[primary],colorB:[secondary],colorC:[tertiary],line:[ink] },
          critters: { body:[primary],accent:[secondary],ink:[ink] },
          thumbs: { shape:[primary],eyes:[ink],mouth:[ink] },
          'line-face': { ink:[ink] },
          slice: { body:[primary] }, glyphs: { glyph:[primary] },
          blobs: { blob:[primary] }, waves: { wave:[primary] },
          squircles: { shape:[primary] }, disco: { shape:[primary] },
          cameo: { body:[primary],shade:[ink+'57',frost+'8f'] },
          landscape: { orb:[secondary],hill1:[tertiary],hill2:[primary],hill3:[secondary],hill4:[ink] },
          stripes: { stripe:[primary] }, rings: { ring:[primary,secondary] },
          planets: { planet:[primary],moon:[secondary] },
          dylan: { hair:[ink],skin:[frost] }, gaze: { body:[primary],ink:[ink] },
          pixelbot: { glow:[primary] }, 'croodles-neutral': { ink:[ink] },
        };
        if (naturalFeatures) {
          // Features carry meaning: skin and hair do not inherit the background
          // hue; pupils and highlights remain a neutral, readable pair.
          roles.gaze = { body:[primary],ink:['#25313A'],glint:['#FFFDF8'] };
          roles.thumbs = { shape:[primary],eyes:['#25313A'],mouth:['#25313A'] };
          roles.critters = { body:[primary],accent:[secondary],ink:['#25313A'] };
          roles.dylan = { hair:['#2C2927','#4A3328','#695246'],skin:['#E8B99B','#D7A17F','#BF8667'] };
          roles.cameo = { body:['#E8B99B','#D7A17F','#BF8667'],shade:['#33292299','#FFF5E199'] };
        }
        // These characters are solid silhouettes with eyes. The paired accent
        // separates the subject's hue from its background; features stay neutral.
        if (distinctCharacter) {
          roles.gaze.body = [secondary];
          roles.thumbs.shape = [secondary];
        }
        if (name === 'background') values = [shared!.value];
        else values = roles[family]?.[name] ?? colors;
        return [name, { ...color, values }];
      }
      if (name === 'background') values = shared ? (family === 'glass' ? [shared.value,blend(shared.value,shared.ink,.08)] : [shared.value]) : family === 'glass' ? [gray, middle] : [frost];
      // Line Face draws every facial feature with ink. A background-colored
      // ink choice makes the entire face disappear, so ink must stay dark.
      else if (name === 'ink') values = [ink];
      else if (['eyes', 'mouth'].includes(name)) values = [ink, frost];
      else if (name === 'shade') values = [ink + '57', frost + '8f'];
      else if (name === 'orb' || name === 'hill1') values = [mist];
      else if (name === 'hill2') values = [middle];
      else if (name === 'hill3') values = [gray];
      else if (name === 'hill4') values = [ink];
      else if (['blob', 'wave'].includes(name)) values = [gray];
      return [name, { ...color, values }];
    }));
    style = new Style({ ...definition, colors: themedColors });
    styles.set(cacheKey, style);
    if (styles.size > 96) styles.delete(styles.keys().next().value!);
  }
  const definition = definitions[family as keyof typeof definitions];
  // v6 uses the unmodified DiceBear component distribution. Legacy avatars retain their appearance.
  const variants = shared || /^c\d{1,3}_v[67]_/.test(seed) ? {} : avatarVariantPreferences(family, seed, definition.components as Parameters<typeof avatarVariantPreferences>[2]);
  const shapeSeed = seed.replace(/^p[a-z]+_v(?:8|9|10|11|12|13)_/, 'v6_').replace(/^c(\d+)_v7_/, 'c$1_v6_').replace(/^p[0-5]_v4_/, 'v4_').replace(/^c\d{1,3}_v([56])_/, 'v$1_');
  const svg = new Avatar(style, { seed: shapeSeed, size: 256, animationVariant: animated ? 'slow' : 'none', ...variants }).toString();
  // This rule lives inside the SVG so it also applies when rendered as an img.
  const preserveFeatures = naturalFeatures && ['dylan','gaze'].includes(family);
  const mutedSvg = !preserveFeatures && ['croodles-neutral','dylan','fun-emoji','gaze','pixelbot','rings','stripes','planets','disco'].includes(family)
    ? svg.replace(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi, (match, raw: string) => {
      if (shared && match.toLowerCase() === shared.value.toLowerCase()) return shared.value;
      const hex = raw.length === 3 ? raw.split('').map((v: string) => v + v).join('') : raw;
      const channels = [0,2,4].map(offset => parseInt(hex.slice(offset, offset + 2),16));
      const lightness = (Math.max(...channels) + Math.min(...channels)) / 510;
      return adjusted[Math.min(4, Math.round((1 - lightness) * 4))];
    }) : svg;
  // v8 includes the same actual palette background in previews and saved avatars.
  // Glyphs has its own opaque white canvas and tint inside the frame, which
  // would otherwise cover the chosen background. Keep its mask and artwork.
  const visibleBackground = shared && family === 'glyphs'
    ? mutedSvg.replace(/<path fill="white" d="M0 0h72v72H0z"\/><path opacity="\.2" fill="[^"]+" d="M0 0h72v72H0z"\/>/g, '')
    : mutedSvg;
  const withBackground = shared ? visibleBackground.replace(/(<svg\b[^>]*>)/, `$1<metadata id="bambook-attribution">Colors and background modified by Bambook. Attribution: https://bambook.sylway.cloud/avatars/dicebear/LICENSE.txt</metadata><rect data-bambook-background="${shared.id}" width="100%" height="100%" fill="${shared.value}"/>`) : visibleBackground;
  const accessibleSvg = withBackground.replace('</svg>', '<style>@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style></svg>');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(accessibleSvg)}`;
}

export function avatarCredit(family: string) {
  const meta = definitions[family as keyof typeof definitions]?.meta;
  return meta?.license.name === 'CC BY 4.0' ? { family, creator: meta.creator.name, url: `https://www.dicebear.com/styles/${family}/` } : null;
}
