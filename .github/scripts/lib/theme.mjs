/**
 * Shared visual language for the generated README panels.
 *
 * Every panel is a self-contained SVG committed into the repository, so the
 * profile depends on no third-party rendering service. The palette and chrome
 * live here so the panels read as one system rather than five separate images.
 */

import { readFile } from 'node:fs/promises';

/** Night City: acid yellow leads, cyan supports, magenta is the glitch. */
export const C = {
  void: '#05050A',
  panel: '#0A0A12',
  yellow: '#FCEE0A',
  cyan: '#00F0FF',
  magenta: '#FF003C',
  grid: '#16323A',
  muted: '#5C7A80',
  text: '#D7F7FA',
};

/** Contribution ramp, shared by the 3D graph and the breach matrix. */
export const RAMP = ['#12161C', '#1A5561', '#00A5B5', '#00F0FF', '#FCEE0A'];

/**
 * GitHub renders README images inside <img>, which blocks webfonts, so both
 * faces are inlined as data URIs. They are glyph-subsetted to what these panels
 * emit, costing about 15 KB. Rajdhani and Share Tech Mono are both SIL OFL,
 * which permits embedding.
 */
export async function loadFonts() {
  const dir = new URL('../../fonts/', import.meta.url);
  const [display, mono, jp] = await Promise.all([
    readFile(new URL('rajdhani-700.woff2', dir)),
    readFile(new URL('sharetechmono.woff2', dir)),
    readFile(new URL('notosansjp-700.woff2', dir)),
  ]);
  return {
    display: display.toString('base64'),
    mono: mono.toString('base64'),
    jp: jp.toString('base64'),
  };
}

export function fontCss(fonts) {
  return `@font-face { font-family: 'RJ'; font-style: normal; font-weight: 700; src: url(data:font/woff2;base64,${fonts.display}) format('woff2'); }
@font-face { font-family: 'STM'; font-style: normal; font-weight: 400; src: url(data:font/woff2;base64,${fonts.mono}) format('woff2'); }
@font-face { font-family: 'JP'; font-style: normal; font-weight: 700; src: url(data:font/woff2;base64,${fonts.jp}) format('woff2'); }
.jp { font-family: 'JP', sans-serif; font-weight: 700; }
.display { font-family: 'RJ', 'Arial Narrow', sans-serif; font-weight: 700; }
.mono { font-family: 'STM', ui-monospace, Consolas, monospace; }`;
}

/** Scanlines, hazard tape and neon bloom -- the three recurring textures. */
export function sharedDefs() {
  return `<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
<rect width="4" height="2" fill="#000000" opacity="0.30"/>
</pattern>
<pattern id="hazard" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="9" height="18" fill="${C.yellow}"/>
<rect x="9" width="9" height="18" fill="${C.void}"/>
</pattern>
<filter id="glow" x="-8%" y="-40%" width="116%" height="180%">
<feGaussianBlur stdDeviation="4" result="b"/>
<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>`;
}

/** Angular notched corners -- the game's HUD frames every panel this way. */
export function corners(W, H, len = 26, inset = 16) {
  return [
    [inset, inset, 1, 1],
    [W - inset, inset, -1, 1],
    [inset, H - inset, 1, -1],
    [W - inset, H - inset, -1, -1],
  ]
    .map(([x, y, dx, dy]) =>
      `<path d="M ${x} ${y + dy * len} L ${x} ${y} L ${x + dx * len} ${y}" fill="none" stroke="${C.yellow}" stroke-width="2"/>`
    )
    .join('\n');
}

/** Chromatic aberration: the same string three times, offset in magenta and cyan. */
export function glitch(text, { x, y, size, anchor = 'start', spread = 3.5 }) {
  const base = `class="display" x="${x}" y="${y}" font-size="${size}" letter-spacing="2"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}`;
  return `<g>
<text ${base} fill="${C.magenta}" opacity="0.9" transform="translate(${-spread},1)">${esc(text)}</text>
<text ${base} fill="${C.cyan}" opacity="0.9" transform="translate(${spread},-1)">${esc(text)}</text>
<text ${base} fill="${C.yellow}">${esc(text)}</text>
</g>`;
}

export function scanlines(W, H) {
  return `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#scan)"/>`;
}

/** A section heading in the recurring "// LABEL" HUD idiom. */
export function heading(label, { x, y, rule = 0 }) {
  return `<text class="mono" x="${x}" y="${y}" font-size="14" fill="${C.cyan}" letter-spacing="1.5">// ${esc(label)}</text>` +
    (rule ? `<rect x="${x}" y="${y + 10}" width="${rule}" height="2" fill="${C.yellow}" opacity="0.65"/>` : '');
}

export function fmt(n) {
  return Number(n.toFixed(2));
}

export function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}


/**
 * Breach-protocol grid: the hex-pair matrix from the game's quickhack minigame.
 * Values are drawn from a caller-supplied seed so the panel is deterministic --
 * the renderer must not use Math.random, or every run would churn the file.
 */
export function breachGrid(x, y, cols, rows, seed, cell = 26) {
  const CODES = ['1C', 'BD', '55', 'E9', '7A', 'FF'];
  let h = seed;
  const next = () => (h = (h * 1103515245 + 12345) & 0x7fffffff);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const code = CODES[next() % CODES.length];
      const hot = next() % 7 === 0;
      out.push(
        `<text class="mono" x="${x + c * cell}" y="${y + r * cell}" font-size="12" ` +
        `fill="${hot ? C.yellow : C.grid}" opacity="${hot ? 0.95 : 0.5}">${code}</text>`
      );
    }
  }
  return out.join('');
}

/** Datamosh blocks -- small offset slabs that read as a corrupted frame. */
export function glitchBlocks(x, y, w, seed) {
  let h = seed;
  const next = () => (h = (h * 1103515245 + 12345) & 0x7fffffff);
  return Array.from({ length: 7 }, () => {
    const bx = x + (next() % w);
    const by = y + (next() % 40);
    const bw = 6 + (next() % 34);
    const colour = next() % 2 ? C.cyan : C.magenta;
    return `<rect x="${bx}" y="${by}" width="${bw}" height="2" fill="${colour}" opacity="0.55"/>`;
  }).join('');
}
