"""Rebuild offline CJK faces with fonttools==4.68.0 and brotli==1.2.1.

Input provenance and license: server/assets/fonts/README.md.
"""
import argparse
import hashlib
from collections import defaultdict
from copy import deepcopy
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE_SHA = 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964'


def build_face(source, output, weight, style):
    font = TTFont(source, recalcTimestamp=False)
    instantiateVariableFont(font, {'wght': weight}, inplace=True)
    by_glyph = defaultdict(list)
    for codepoint, glyph in sorted(font.getBestCmap().items()):
        by_glyph[glyph].append(codepoint)
    order, clones = font.getGlyphOrder(), {}
    for glyph, codepoints in by_glyph.items():
        for codepoint in codepoints[1:]:
            name = f'uni{codepoint:06X}.unique'
            font['glyf'][name] = deepcopy(font['glyf'][glyph])
            font['hmtx'][name] = font['hmtx'][glyph]
            if 'vmtx' in font:
                font['vmtx'][name] = font['vmtx'][glyph]
            # glyf may already have appended to the shared glyph order.
            if name not in order:
                order.append(name)
            clones[codepoint] = name
    font.setGlyphOrder(order)
    for table in font['cmap'].tables:
        if table.isUnicode() and hasattr(table, 'cmap'):
            for codepoint in list(table.cmap):
                if codepoint in clones:
                    table.cmap[codepoint] = clones[codepoint]
    family, full = 'Bambook Document Sans', 'Bambook Document Sans ' + style
    names = {1: family, 2: style, 3: full + ' 1.0', 4: full,
             6: 'BambookDocumentSans-' + style, 16: family, 17: style}
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    font.flavor = 'woff2'
    target = output / ('BambookDocumentSans-' + style + '.woff2')
    font.save(target)
    print(style, 'clones', len(clones), 'bytes', target.stat().st_size,
          'sha', hashlib.sha256(target.read_bytes()).hexdigest(), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != SOURCE_SHA:
        raise ValueError('Source font differs from the pinned upstream file')
    args.output.mkdir(parents=True, exist_ok=True)
    for weight, style in [(400, 'Regular'), (700, 'Bold')]:
        build_face(args.source, args.output, weight, style)
