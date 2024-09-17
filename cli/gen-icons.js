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
    d = 'd="M 0 .5 C 0 0 0 0 .5 0 S 1 0 1 .5 1 1 .5 1 0 1 0 .5"'; // approx. squircle

for(let x of ['swift', 'popup', 'disable']) {
    for(let y of ['passive', 'proactive']) {
        save(`<svg ${SVG}>
  <g ${XFM}>
    <path ${d} transform="translate(0 0) scale(${b})" opacity="${x === 'swift' ? 0 : 1}"/>
    <path ${d} transform="translate(${c} 0) scale(${b})" opacity="${x === 'disable' ? 0 : 1}"/>
    <path ${d} transform="translate(0 ${c}) scale(${b})" opacity="${x === 'disable' ? 0 : 1}"/>
    <path ${d} transform="translate(${c} ${c}) scale(${b})" opacity="${y === 'passive' ? 0.5 : 1}"/>
  </g>
</svg>`, `ld-${x}-${y}-symbolic.svg`);
    }
}
