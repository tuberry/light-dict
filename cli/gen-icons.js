// vim:fdm=syntax
// by tuberry

import Gio from 'gi://Gio';

const L = 16;
const n = 1 / 16;
const m = n * L;
const W = L - 2 * m;
const fill = 'fill="#444"';

let g = W / 8,
    w = (W - g) / 2,
    r = w / 4,
    p = m + g + w;

for(let x of ['swift', 'popup', 'disable']) {
    for(let y of ['passive', 'proactive']) {
        Gio.File.new_for_path(ARGV.concat(`ld-${x}-${y}-symbolic.svg`).join('/')).replace_contents(`<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${L}" version="1.1">
 <rect width="${w}" height="${w}" rx="${r}" x="${m}" y="${m}" ${fill} fill-opacity="${x === 'swift' ? 0 : 1}"/>
 <rect width="${w}" height="${w}" rx="${r}" x="${p}" y="${m}" ${fill} fill-opacity="${x === 'disable' ? 0 : 1}"/>
 <rect width="${w}" height="${w}" rx="${r}" x="${m}" y="${p}" ${fill} fill-opacity="${x === 'disable' ? 0 : 1}"/>
 <rect width="${w}" height="${w}" rx="${r}" x="${p}" y="${p}" ${fill} fill-opacity="${y === 'passive' ? 0.5 : 1}"/>
</svg>`, null, false, Gio.FileCreateFlags.NONE, null);
    }
}
