# Document CJK font

Bambook Document Sans is a renamed derivative of Noto Sans SC, under the included SIL Open Font License 1.1. Upstream copyright notices remain in the font metadata.

- Source: [Noto Sans SC variable TTF](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf)
- Upstream commit: `f8d157532fbfaeda587e826d4cd5b21a49186f7c`
- Source SHA-256: `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`
- Changes: instantiate weights 400/700, duplicate shared glyph outlines and metrics so each Unicode cmap entry has its own glyph ID, rename the derivative family, compress to WOFF2. Outlines and business text are not normalized or substituted.
- Why: Chromium on macOS can reverse a shared glyph ID to a radical instead of the input ideograph when writing PDF ToUnicode. Merely switching to the unchanged Noto font or waiting for fonts does not fix this. Distinct glyph IDs also preserve literal radicals and compatibility characters.
- Usage: `documentFont.ts` embeds these assets as data URLs for server PDFs, with a CJK-only unicode range. Existing Latin and monospace stacks remain. Both source and compiled server paths resolve to this directory; direct deployment includes tracked server assets. No external font requests occur.

To rebuild, install development-only `fonttools==4.68.0` and `brotli==1.2.1`, download the pinned source, then run:

```sh
python server/scripts/build-document-fonts.py /path/to/NotoSansSC-VF.ttf server/assets/fonts
```

Run the real-browser regression from the repository root (Chrome installed, or `BAMBOOK_PDF_BROWSER_PATH` pointing to Chromium):

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs server/scripts/verify-document-pdf.cjs --source
```

After `npm --prefix server run build`, omit `--source` and the loader to verify the compiled renderer. The check parses actual PDFs without Unicode normalization, covers literal ideographs/radicals at three weights, and checks a one-page quotation including Chinese monospace text plus a 70-row quotation with a single grand total. It does not write business records or rewrite archived files.

Output SHA-256 (FontTools 4.68.0 / Brotli 1.2.1):

- Regular: `781637e03e0d4c8788be256541b1afd19769c160d5c59d4c89dd743a4245ebbf`
- Bold: `7dccb4b1dc0f9de06e63fb83d94c34d114e21ea0fc7a15388cb26b711d70689a`
