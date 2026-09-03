#!/usr/bin/env node
/**
 * Restyles the 3D contribution graph's typography to match the activity graph.
 *
 * github-profile-3d-contrib hardcodes its font stack and exposes no setting for
 * it, so the generated SVG is rewritten in place: the stock stack is swapped for
 * the same embedded Rajdhani face the activity graph uses. Without this the two
 * panels share a palette but not a voice.
 *
 * Env:
 *   TARGET  path to the generated SVG (default: profile-3d-contrib/profile-cyberpunk.svg)
 */

import { readFile, writeFile } from 'node:fs/promises';

const target = process.env.TARGET || 'profile-3d-contrib/profile-cyberpunk.svg';

const fonts = new URL('../fonts/', import.meta.url);
const rajdhani = (await readFile(new URL('rajdhani-700.woff2', fonts))).toString('base64');

const svg = await readFile(target, 'utf8');

// The action emits exactly this rule as the first thing inside <style>.
const STOCK = '* { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }';
if (!svg.includes(STOCK)) {
  // Warn rather than fail. If upstream changes this markup, the graph should
  // keep refreshing with stock typography -- failing the job here would freeze
  // the graphs, which is the staleness this whole workflow exists to prevent.
  // The regression announces itself anyway: the font visibly reverts.
  console.warn(`Stock font rule not found in ${target}; leaving its typography alone.`);
  process.exit(0);
}

const replacement =
  `@font-face { font-family: 'RJ'; font-style: normal; font-weight: 700; ` +
  `src: url(data:font/woff2;base64,${rajdhani}) format('woff2'); }\n` +
  `* { font-family: 'RJ', 'Arial Narrow', sans-serif; font-weight: 700; letter-spacing: 0.5px; }`;

await writeFile(target, svg.replace(STOCK, replacement), 'utf8');
console.log(`Restyled ${target} to the shared display face`);
