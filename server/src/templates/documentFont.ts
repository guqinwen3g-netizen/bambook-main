import { readFileSync } from 'node:fs';
import path from 'node:path';

let styles: string | undefined;
/**
 * Bundled, offline CJK faces with one Unicode value per glyph. Some system CJK fonts
 * share glyph IDs with radicals; Chromium may then print the radical in ToUnicode.
 * Keep Latin and monospace metrics from each template's existing font stack.
 */
export function documentFontStyles(): string {
  if (styles !== undefined) return styles;
  const face = (style: string, weight: number) => {
    // Both src/templates and dist/templates resolve to server/assets/fonts.
    const bytes = readFileSync(path.resolve(__dirname, '../../assets/fonts', `BambookDocumentSans-${style}.woff2`));
    return `@font-face{font-family:'Bambook Document CJK';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');unicode-range:U+2E80-9FFF,U+F900-FAFF,U+FE10-FE1F,U+FE30-FE4F,U+FF00-FFEF,U+20000-3FFFF;}`;
  };
  // Missing/corrupt assets must fail generation, rather than silently issue a bad original.
  styles = face('Regular', 400) + face('Bold', 700);
  return styles;
}
