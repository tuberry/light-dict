// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';

const L = 16; // length (side)
const M = 1 / 16; // margin
const W = 1 - 2 * M; // width (content)
const C = '#28282B'; // color
const XFM = `fill="${C}" transform="translate(${M} ${M}) scale(${W} ${W})"`;
const SVG = `viewBox="0 0 1 1" width="${L}" height="${L}" xmlns="http://www.w3.org/2000/svg"`;
const save = (text, name) => Gio.File.new_for_path(ARGV.concat(name).join('/'))
    .replace_contents(text, null, false, Gio.FileCreateFlags.NONE, null);

let a = 1 / 7, // gap
    b = (1 - a) / 2 / 2, // half squircle side length
    c = a + b * 2,
    d = 2 * a / (1 - a), // d / (4 + d) = a / 2;
    e = b * Math.SQRT1_2, // diamond length
    box = `M1 0 C0 0 0 0 0 1 S0 2 1 2 h${2 + d * 2} c1 0 1 0 1 -1 s0 -1 -1 -1 L${2 + d} ${1 + d}Z`; // swift box

for(let x of ['swift', 'popup', 'disable']) {
    for(let y of ['passive', 'proactive']) {
        save(`<svg ${SVG}>
  <g ${XFM}>
    <path d="${box}" transform="translate(0, ${c}) scale(${b})" opacity="${x === 'disable' ? .5 : 1}"/>
    <path d="M2 1 C2 0 2 0 1 0 S0 0 0 1 0 2 1 2Z" transform="translate(0, 0) scale(${b})" opacity="${x === 'popup' ? 1 : .5}"/>
    <path d="M1 2 C2 2 2 2 2 1 S2 0 1 0 0 0 0 1Z" transform="translate(${c}, 0) scale(${b})" opacity="${x === 'popup' ? 1 : .5}"/>
    <rect x="-1" y="-1" width="2" height="2" transform="translate(0.5 0.5) rotate(45) scale(${e})" opacity="${y === 'passive' ? 1 : 0}"/>
  </g>
</svg>`, `ld-${x}-${y}-symbolic.svg`);
    }
}
