// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';

const L = 16; // length (side)
const M = 1 / 16; // margin
const W = 1 - 2 * M; // width (content)
const C = 'dimgrey'; // color
const XFM = `fill="${C}" transform="translate(${M} ${M}) scale(${W} ${W})"`;
const SVG = `viewBox="0 0 1 1" width="${L}" height="${L}" xmlns="http://www.w3.org/2000/svg"`;
const save = (text, name) => Gio.File.new_for_path(ARGV.concat(name).join('/'))
    .replace_contents(text, null, false, Gio.FileCreateFlags.NONE, null);

let a = 1 / 8,
    b = (1 - a) / 2,
    c = a + b,
    d = b / 4;

for(let x of ['swift', 'popup', 'disable']) {
    for(let y of ['passive', 'proactive']) {
        save(`<svg ${SVG}>
  <g ${XFM}>
    <rect width="${b}" height="${b}" rx="${d}" x="0" y="0" opacity="${x === 'swift' ? 0 : 1}"/>
    <rect width="${b}" height="${b}" rx="${d}" x="${c}" y="0" opacity="${x === 'disable' ? 0 : 1}"/>
    <rect width="${b}" height="${b}" rx="${d}" x="0" y="${c}" opacity="${x === 'disable' ? 0 : 1}"/>
    <rect width="${b}" height="${b}" rx="${d}" x="${c}" y="${c}" opacity="${y === 'passive' ? 0.5 : 1}"/>
  </g>
</svg>`, `ld-${x}-${y}-symbolic.svg`);
    }
}
