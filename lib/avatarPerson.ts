import { Avatar, Style } from '@dicebear/core';
import definition from '@dicebear/styles/toon-head.json';
import type { PersonAvatar } from '../server/src/shared/avatarAppearance';
const style = new Style(definition);
/** Render the original ToonHead components without repainting skin or altering their geometry. */
export function generatePersonAvatar(value: PersonAvatar): string {
  const svg = new Avatar(style, {
    seed:value.seed, size:256,
    hairVariant:value.hair === 'none' ? 'sideComed' : value.hair, hairProbability:value.hair === 'none' ? 0 : 100,
    rearHairVariant:value.backHair === 'none' ? 'longStraight' : value.backHair, rearHairProbability:value.backHair === 'none' ? 0 : 100,
    eyesVariant:value.eyes, eyebrowsVariant:value.brows, mouthVariant:value.mouth, clothesVariant:value.clothes,
    beardProbability:0, hairColor:value.hairColor, skinColor:value.skin, clothesColor:value.clothesColor,
    backgroundColor:value.background, strokeColor:'#483F39',
  }).toString();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
