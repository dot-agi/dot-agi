#!/usr/bin/env node
/**
 * Renders every generated panel in the profile README from live GitHub data.
 *
 * One GraphQL call feeds four self-contained SVGs, so the profile depends on no
 * third-party rendering service -- the reason the previous activity graph broke
 * was its host being switched off.
 *
 * Env:
 *   GITHUB_TOKEN  token for the GraphQL call (the workflow's default token is enough)
 *   USERNAME      login to render
 *   OUT_DIR       output directory (default: assets)
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { C, RAMP, loadFonts, fontCss, sharedDefs, corners, glitch, scanlines, heading,
         breachGrid, glitchBlocks, scanSweep, ramPips, chevrons, flicker, fmt, esc } from './lib/theme.mjs';

const token = process.env.GITHUB_TOKEN;
const username = process.env.USERNAME;
const outDir = process.env.OUT_DIR || 'assets';

/**
 * Canvas width for every panel.
 *
 * GitHub renders a README image into a column roughly 900px wide, and the
 * panels are emitted at `width="100%"`. Drawing at this width means one SVG
 * unit is one rendered pixel: a `font-size="13"` here is 14px on the page. The
 * panels used to be drawn 1280 wide and scaled down by 0.7, which quietly
 * shrank every label to about two thirds of its stated size.
 */
const CANVAS = 900;
/** Shared side margin, so every panel's content lines up down the page. */
const M = 32;

if (!token) throw new Error('GITHUB_TOKEN is required');
if (!username) throw new Error('USERNAME is required');

// No date range: this is GitHub's default trailing-year calendar, the same
// window github-profile-3d-contrib uses, so every panel reports one period.
const QUERY = `
  query ($login: String!, $prQuery: String!) {
    externalMerged: search(query: $prQuery, type: ISSUE) { issueCount }
    user(login: $login) {
      login
      name
      followers { totalCount }
      repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]) {
        totalCount
      }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
        totalCount
        nodes {
          stargazerCount
          forkCount
          languages(first: 10) { nodes { name } }
        }
      }
      contributionsCollection {
        restrictedContributionsCount
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoryContributions
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

const response = await fetchWithRetry('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'readme-panel-renderer',
  },
  body: JSON.stringify({
    query: QUERY,
    variables: {
      login: username,
      // Merged into repositories this account does not own -- work other
      // maintainers reviewed and accepted. Public repos only.
      prQuery: `author:${username} is:pr is:merged is:public -user:${username}`,
    },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL API returned ${response.status}: ${await response.text()}`);
}
const payload = await response.json();
if (payload.errors) throw new Error(`GitHub GraphQL API errors: ${JSON.stringify(payload.errors)}`);

const externalMerged = payload.data?.externalMerged?.issueCount ?? 0;
const user = payload.data?.user;
if (!user) throw new Error(`No data returned for "${username}"`);

const cc = user.contributionsCollection;
const calendar = cc.contributionCalendar;

// The calendar is week-aligned, so its final week can run past today; those days
// come back as zeros and would draw a cliff at the right edge.
const today = new Date().toISOString().slice(0, 10);
const days = calendar.weeks
  .flatMap((w) => w.contributionDays)
  .filter((d) => d.date <= today)
  .map((d) => ({ date: d.date, count: d.contributionCount }))
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

if (days.length === 0) throw new Error(`Empty contribution calendar for "${username}"`);

const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
const languages = new Set(user.repositories.nodes.flatMap((r) => r.languages.nodes.map((l) => l.name)));
const busiest = days.reduce((best, d) => (d.count > best.count ? d : best), days[0]);
const activeDays = days.filter((d) => d.count > 0).length;
const range = `${days[0].date} / ${days[days.length - 1].date}`;

const fonts = await loadFonts();
await mkdir(outDir, { recursive: true });

await write('hero.svg', hero());
await mkdir(`${outDir}/headings`, { recursive: true });
for (const [name, body] of Object.entries(headingBanners())) {
  await write(`headings/${name}`, body);
}
await write('attributes.svg', attributes());
await write('activity-graph.svg', activityGraph());
await write('breach.svg', breach());
await write('footer.svg', footer());

console.log(`Rendered 5 panels and 5 heading banners for ${username} — ${calendar.totalContributions} contributions, ${range}`);

async function write(name, body) {
  await writeFile(`${outDir}/${name}`, body, 'utf8');
}

/** Wraps a panel body in the shared frame, defs and scanline overlay. */
function panel(W, H, label, body, extraDefs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<defs>
<style>${fontCss(fonts)}</style>
${sharedDefs()}
${extraDefs}
</defs>
<rect x="0" y="0" width="${W}" height="${H}" fill="${C.void}"/>
${body}
${corners(W, H)}
${scanlines(W, H)}
</svg>
`;
}

/** Masthead: name, handle and role, framed like a character-select screen. */
function hero() {
  const W = CANVAS;
  const H = 336;
  const display = (user.name || user.login).toUpperCase();
  const rows = [
    ['CLASS', 'NETRUNNER'],
    ['SPEC', 'ARTIFICIAL INTELLIGENCE'],
    ['STATUS', 'JACKED IN'],
  ];
  const colX = W - 330;
  const info = rows
    .map(([k, v], i) => {
      const y = 152 + i * 38;
      return `<text class="mono" x="${colX}" y="${y}" font-size="13" fill="${C.muted}" letter-spacing="1.5">${k}</text>` +
        `<text class="mono" x="${W - M}" y="${y}" font-size="14" fill="${C.cyan}" text-anchor="end" letter-spacing="1">${esc(v)}</text>` +
        `<rect x="${colX}" y="${y + 11}" width="${W - M - colX}" height="1" fill="${C.grid}"/>`;
    })
    .join('\n');

  // Seed the decorative grid from the contribution total: it changes only when
  // the data does, so the file stays stable between runs.
  const seed = calendar.totalContributions * 7919 + days.length;

  return panel(W, H, `${display} — netrunner profile`, `
${breachGrid(colX, 62, 10, 2, seed, 27)}
<rect x="${M}" y="48" width="264" height="18" fill="url(#hazard)" opacity="0.85"/>
${glitchBlocks(M, 92, 320, seed + 13)}
<text class="jp" x="${M + 22}" y="302" font-size="15" fill="${C.magenta}" opacity="0.85" letter-spacing="4">サイバーパンク</text>
<text class="jp" x="${W - M - 26}" y="302" font-size="15" fill="${C.cyan}" opacity="0.7" text-anchor="end" letter-spacing="4">ナイトシティ</text>
<text class="mono" x="${colX}" y="270" font-size="14" fill="${C.muted}" letter-spacing="1.5">RAM</text>
${ramPips(colX + 52, 259, 12, { size: 10, gap: 5, dur: 4.4 })}
<rect x="${colX}" y="281" width="${W - M - colX}" height="1" fill="${C.grid}"/>
${glitch(display, { x: M, y: 132, size: 56 })}
<rect x="${M}" y="150" width="250" height="3" fill="${C.yellow}"/>
<text class="mono" x="${M}" y="188" font-size="17" fill="${C.cyan}" letter-spacing="2">@${esc(user.login)}${flicker(9)}</text>
<text class="display" x="${M}" y="226" font-size="26" fill="${C.text}" letter-spacing="2">ONLY THE BEST SURVIVE</text>
<text class="mono" x="${M}" y="250" font-size="13" fill="${C.muted}" letter-spacing="1.2">SCALABLE SYSTEMS &lt;&gt; AI RESEARCH &lt;&gt; OPEN TO COLLAB</text>
${info}
${chevrons(M, 268, 4, { dur: 1.8, colour: C.yellow })}
${scanSweep('heroScan', 16, 16, W - 32, H - 32, { dur: '7s', band: 300, opacity: 0.1 })}
`);
}

/**
 * Section headings, drawn whole rather than as an icon beside markdown text.
 *
 * An `<img>` in a markdown heading can only be positioned with the legacy
 * `align` attribute, and HTML maps both "center" and "middle" to "align the
 * image's vertical centre with the parent's baseline" -- which drops the icon
 * half its height below the words. GitHub strips `style`, so there is no way to
 * fix that alignment from the markdown side. Drawing the icon and the label
 * into one image removes the question, and lets the headings use the same
 * display face and palette as the panels instead of GitHub's UI font.
 *
 * SMIL animation plays in a README image, which is how the stock GitHub heading
 * GIFs work -- these do the same thing without a third-party GIF host.
 */
function headingBanners() {
  const W = 460;
  const H = 46;
  const pulse = (dur, from = '0.35', to = '1') =>
    `<animate attributeName="opacity" values="${from};${to};${from}" dur="${dur}" repeatCount="indefinite"/>`;

  // Every glyph is authored in a 34x34 box and scaled into the plate.
  const icons = {
    // A terminal prompt with a blinking cursor.
    dossier:
      `<rect x="2" y="5" width="30" height="24" rx="2" fill="none" stroke="${C.cyan}" stroke-width="2"/>` +
      `<path d="M7 12l4 5-4 5" fill="none" stroke="${C.yellow}" stroke-width="2" stroke-linecap="round"/>` +
      `<rect x="15" y="20" width="10" height="2.5" fill="${C.yellow}">` +
      `<animate attributeName="opacity" values="1;1;0;0" dur="1.1s" repeatCount="indefinite"/></rect>`,
    // Attribute bars filling in sequence.
    attributes: [6, 13, 20, 27]
      .map((y, i) => {
        const w = [22, 15, 26, 11][i];
        // Never shrink past ~45%, so the glyph always reads as bars rather
        // than as a column of dots mid-cycle.
        const lo = Math.round(w * 0.45);
        return `<rect x="4" y="${y - 2}" width="${w}" height="4" fill="${i % 2 ? C.cyan : C.yellow}">` +
          `<animate attributeName="width" values="${lo};${w};${lo}" dur="${2.4 + i * 0.3}s" repeatCount="indefinite"/></rect>`;
      })
      .join(''),
    // A chip with a pulsing core.
    cyberware:
      `<rect x="9" y="9" width="16" height="16" rx="1" fill="none" stroke="${C.yellow}" stroke-width="2"/>` +
      `<rect x="14" y="14" width="6" height="6" fill="${C.cyan}">${pulse('1.6s')}</rect>` +
      ['M17 2v7', 'M17 25v7', 'M2 17h7', 'M25 17h7']
        .map((d, i) => `<path d="${d}" stroke="${C.cyan}" stroke-width="2" stroke-linecap="round">${pulse(`${1.4 + i * 0.2}s`, '0.25')}</path>`)
        .join(''),
    // A trace sweeping across a waveform.
    activity:
      `<polyline points="2,24 7,24 10,12 14,20 18,7 22,18 26,14 32,14" fill="none" stroke="${C.yellow}" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<rect x="0" y="2" width="4" height="30" fill="${C.cyan}" opacity="0.5">` +
      `<animate attributeName="x" values="-4;32" dur="2.6s" repeatCount="indefinite"/></rect>`,
    // Broadcast arcs expanding outward.
    uplink:
      `<circle cx="17" cy="24" r="3" fill="${C.yellow}"/>` +
      [8, 14, 20]
        .map((r, i) =>
          `<path d="M${17 - r} 24a${r} ${r} 0 0 1 ${r * 2} 0" fill="none" stroke="${C.cyan}" stroke-width="2" stroke-linecap="round">` +
          `<animate attributeName="opacity" values="0;1;0" dur="2s" begin="${i * 0.45}s" repeatCount="indefinite"/></path>`
        )
        .join(''),
  };

  const sections = [
    ['dossier', 'DOSSIER'],
    ['attributes', 'ATTRIBUTES'],
    ['cyberware', 'CYBERWARE'],
    ['activity', 'NET ACTIVITY'],
    ['uplink', 'UPLINK'],
  ];

  const out = {};
  sections.forEach(([slug, label], i) => {
    const index = String(i + 1).padStart(2, '0');
    // Chamfered top-right and bottom-left corners: the game cuts every plate
    // on the same diagonal.
    const plate = `M0 0 H${W - 12} L${W} 12 V${H} H12 L0 ${H - 12} Z`;
    out[`${slug}.svg`] =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<defs><style>${fontCss(fonts)}</style>
<linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="${C.cyan}" stop-opacity="0"/>
<stop offset="50%" stop-color="${C.cyan}" stop-opacity="0.5"/>
<stop offset="100%" stop-color="${C.cyan}" stop-opacity="0"/>
</linearGradient></defs>
<path d="${plate}" fill="${C.panel}"/>
<rect x="0" y="0" width="5" height="${H}" fill="${C.yellow}">
<animate attributeName="fill" values="${C.yellow};${C.cyan};${C.yellow}" dur="${fmt(3.4 + i * 0.4)}s" repeatCount="indefinite"/>
</rect>
${scanSweep(`plate${i}`, 5, 0, W - 5, H, { dur: `${fmt(4.6 + i * 0.5)}s`, band: 210, opacity: 0.16 })}
<g transform="translate(18,8) scale(0.882)">${icons[slug]}</g>
<text class="display" x="60" y="33" font-size="26" fill="${C.yellow}" letter-spacing="2.5">${esc(label)}${flicker(8 + i)}</text>
<text class="mono" x="${W - 20}" y="31" font-size="13" fill="${C.cyan}" text-anchor="end" letter-spacing="1.5" opacity="0.75">[ ${index} ]</text>
${chevrons(W - 160, 23, 3, { dur: 1.6 })}
</svg>
`;
  });
  return out;
}

/**
 * Character sheet. Each attribute is a GitHub signal that says something about
 * capability rather than raw volume -- breadth of languages, work others chose
 * to star, consistency, judgement applied to other people's code, and reach
 * beyond your own repositories.
 *
 * Every metric has a different natural range, so each is scored against its own
 * reference ceiling on a log curve and reported as a level out of 20, the way
 * the game states attributes. The raw figure is printed alongside so the level
 * is never the only claim being made.
 */
function attributes() {
  const W = CANVAS;
  const H = 520;
  const LEVELS = 20;

  // Stars measure how popular work is, not how capable its author is, so they
  // sit in the cred row below rather than scoring an attribute here.
  /**
   * The five marks from the game's character sheet, redrawn in this palette at
   * 22x22 and each animated on its own cycle so the sheet reads as live.
   */
  const GLYPHS = {
    // Technical ability: a hex nut with a turning core.
    'TECHNICAL ABILITY':
      `<path d="M11 1l8.7 5v10L11 21l-8.7-5V6z" fill="none" stroke="${C.cyan}" stroke-width="2"/>` +
      `<circle cx="11" cy="11" r="3.4" fill="none" stroke="${C.yellow}" stroke-width="2">` +
      `<animateTransform attributeName="transform" type="rotate" from="0 11 11" to="360 11 11" dur="6s" repeatCount="indefinite"/></circle>`,
    // Intelligence: a chip node with traces firing outward.
    INTELLIGENCE:
      `<rect x="6" y="6" width="10" height="10" fill="none" stroke="${C.cyan}" stroke-width="2"/>` +
      `<rect x="9.5" y="9.5" width="3" height="3" fill="${C.yellow}">` +
      `<animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite"/></rect>` +
      ['M11 1v5', 'M11 16v5', 'M1 11h5', 'M16 11h5']
        .map((d, k) => `<path d="${d}" stroke="${C.yellow}" stroke-width="2" stroke-linecap="round">` +
          `<animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin="${k * 0.25}s" repeatCount="indefinite"/></path>`)
        .join(''),
    // Reflexes: a bolt that strikes.
    REFLEXES:
      `<path d="M13 1L4 12h5l-2 9 9-11h-5z" fill="${C.yellow}" stroke="${C.yellow}" stroke-width="1.5" stroke-linejoin="round">` +
      `<animate attributeName="opacity" values="1;0.35;1;1" keyTimes="0;0.08;0.16;1" dur="2.2s" repeatCount="indefinite"/></path>`,
    // Cool: a plume rising off a steady base.
    COOL:
      `<path d="M11 21c-5 0-7-3-7-6 0-4 4-5 4-9 3 2 4 4 4 6 1-1 1.5-2 1.5-3.5 2 2 4 4.5 4 7.5 0 3-2 5-6.5 5z" ` +
      `fill="none" stroke="${C.cyan}" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M11 18c-2 0-2.6-1.4-2.6-2.6 0-1.8 2.6-3.4 2.6-3.4s2.6 1.6 2.6 3.4C13.6 16.6 13 18 11 18z" fill="${C.yellow}">` +
      `<animate attributeName="opacity" values="0.45;1;0.45" dur="1.9s" repeatCount="indefinite"/></path>`,
    // Body: a plated shield with a beating core.
    BODY:
      `<path d="M11 1l9 3v8c0 5-4 8-9 10-5-2-9-5-9-10V4z" fill="none" stroke="${C.cyan}" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M11 6v10M6 11h10" stroke="${C.yellow}" stroke-width="2.4" stroke-linecap="round">` +
      `<animate attributeName="opacity" values="0.5;1;0.5" dur="1.4s" repeatCount="indefinite"/></path>`,
  };

  const attrs = [
    ['TECHNICAL ABILITY', 'DISTINCT LANGUAGES SHIPPED', languages.size, 20],
    ['INTELLIGENCE', 'PRS MERGED INTO OTHERS\' REPOS', externalMerged, 500],
    ['REFLEXES', 'ACTIVE DAYS THIS YEAR', activeDays, 365],
    ['COOL', 'REVIEWS GIVEN ON OTHERS\' CODE', cc.totalPullRequestReviewContributions, 500],
    ['BODY', 'COMMITS THIS YEAR', cc.totalCommitContributions, 3000],
  ];
  const level = (v, ref) =>
    Math.max(1, Math.min(LEVELS, Math.round(1 + (LEVELS - 1) * (Math.log10(v + 1) / Math.log10(ref + 1)))));

  // The bar sits between the widest source line on the left and the "LV nn"
  // readout on the right, so its segments are sized from what is left over.
  const barX = 300;
  const barEnd = W - 116;
  const pitch = (barEnd - barX) / LEVELS;
  const segW = fmt(pitch - 4);

  const rows = attrs
    .map(([name, source, value, ref], i) => {
      const y = 138 + i * 58;
      const lv = level(value, ref);
      const bar = Array.from({ length: LEVELS }, (_, sIdx) => {
        const on = sIdx < lv;
        const colour = !on ? '#101820' : sIdx >= LEVELS - 3 ? C.yellow : C.cyan;
        return `<rect x="${fmt(barX + sIdx * pitch)}" y="${y - 16}" width="${segW}" height="20" fill="${colour}" opacity="${on ? 1 : 0.55}"/>`;
      }).join('');
      // A charge runs the length of the lit segments, clipped to them so it
      // never leaks into the empty part of the track.
      const litW = lv * pitch;
      const charge = `<clipPath id="lit${i}">` +
        Array.from({ length: lv }, (_, sIdx) =>
          `<rect x="${fmt(barX + sIdx * pitch)}" y="${y - 16}" width="${segW}" height="20"/>`).join('') +
        `</clipPath>
<g clip-path="url(#lit${i})"><rect x="0" y="${y - 16}" width="70" height="20" fill="url(#charge)" opacity="0.55">` +
        `<animate attributeName="x" values="${fmt(barX - 70)};${fmt(barX + litW)}" dur="${fmt(3.6 + i * 0.35)}s" repeatCount="indefinite"/></rect></g>`;
      const textX = M + 32;
      return `<g transform="translate(${M},${y - 18})">${GLYPHS[name]}</g>` +
        `<text class="display" x="${textX}" y="${y}" font-size="24" fill="${C.text}" letter-spacing="1">${name}</text>` +
        `<text class="mono" x="${textX}" y="${y + 21}" font-size="13" fill="${C.muted}" letter-spacing="1">${source}</text>` +
        bar + charge +
        `<text class="display" x="${W - M}" y="${y}" font-size="26" fill="${C.yellow}" text-anchor="end">LV ${lv}</text>` +
        `<text class="mono" x="${W - M}" y="${y + 21}" font-size="13" fill="${C.text}" text-anchor="end" letter-spacing="1">${value}</text>`;
    })
    .join('\n');

  const creds = [
    ['STREET CRED', user.followers.totalCount, 'FOLLOWERS'],
    ['EDDIES', stars, 'STARS EARNED'],
    ['CREWS', user.repositoriesContributedTo.totalCount, 'REPOS CONTRIBUTED TO'],
    ['ARSENAL', user.repositories.totalCount, 'REPOS OWNED'],
  ];
  const credW = (W - M * 2) / creds.length;
  const credRow = creds
    .map(([label, value, sub], i) => {
      const x = M + i * credW;
      return `<rect x="${fmt(x)}" y="${H - 112}" width="${fmt(credW - 18)}" height="2" fill="${C.cyan}" opacity="0.5"/>` +
        `<text class="mono" x="${fmt(x)}" y="${H - 92}" font-size="13" fill="${C.cyan}" letter-spacing="1.5">${label}</text>` +
        `<text class="display" x="${fmt(x)}" y="${H - 58}" font-size="30" fill="${C.yellow}">${value}</text>` +
        `<text class="mono" x="${fmt(x)}" y="${H - 38}" font-size="12" fill="${C.muted}" letter-spacing="1">${sub}</text>`;
    })
    .join('\n');

  return panel(W, H, `${user.login} attributes`, `
${heading('CHARACTER SHEET', { x: M, y: 62, rule: 190 })}
<text class="mono" x="${W - M}" y="62" font-size="12" fill="${C.muted}" text-anchor="end" letter-spacing="1">LEVEL / 20 &lt;&gt; LOG-SCORED</text>
<line x1="${M}" y1="88" x2="${W - M}" y2="88" stroke="${C.grid}" stroke-width="1"/>
${rows}
${credRow}
`);
}

/** The contribution rate over the trailing year, as a HUD readout. */
function activityGraph() {
  const W = CANVAS;
  const H = 440;
  const PAD = { top: 196, right: 40, bottom: 68, left: 62 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // A trailing 7-day average keeps the line readable without hiding real spikes.
  // The first WINDOW-1 days are not plotted: averaged over a short window they
  // are a different statistic to every other point, and since the peak sets the
  // y-scale, one busy day at the window start would squash the whole year.
  const WINDOW = Math.min(7, days.length);
  const series = days.slice(WINDOW - 1).map((day, i) => ({
    date: day.date,
    value: days.slice(i, i + WINDOW).reduce((t, d) => t + d.count, 0) / WINDOW,
  }));

  const peak = Math.max(...series.map((p) => p.value));
  const gridCount = 4;
  const gridStep = niceStep(peak / gridCount);
  const yMax = gridStep * gridCount;
  const decimals = Math.max(0, -Math.floor(Math.log10(gridStep)));

  const xAt = (i) => PAD.left + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const yAt = (v) => PAD.top + plotH - (yMax === 0 ? 0 : (v / yMax) * plotH);
  const baseline = PAD.top + plotH;

  const pts = series.map((p, i) => [xAt(i), yAt(p.value)]);
  const line = smoothPath(pts, PAD.top, baseline);
  const area = `${line} L ${fmt(pts[pts.length - 1][0])} ${fmt(baseline)} L ${fmt(pts[0][0])} ${fmt(baseline)} Z`;

  const grid = Array.from({ length: gridCount + 1 }, (_, i) => {
    const y = yAt(gridStep * i);
    return `<line x1="${PAD.left}" y1="${fmt(y)}" x2="${W - PAD.right}" y2="${fmt(y)}" stroke="${C.grid}" stroke-width="1" stroke-dasharray="2 6"/>` +
      `<text class="mono" x="${PAD.left - 12}" y="${fmt(y + 5)}" font-size="13" fill="${C.muted}" text-anchor="end">${(gridStep * i).toFixed(decimals)}</text>`;
  }).join('\n');

  const ticks = [];
  let lastMonth = null;
  series.forEach((p, i) => {
    const m = p.date.slice(0, 7);
    if (m !== lastMonth) {
      lastMonth = m;
      ticks.push({ x: xAt(i), label: monthLabel(p.date) });
    }
  });

  // restrictedContributionsCount is the private slice of the same total, and is
  // only non-zero when the profile is set to include private contributions.
  const priv = cc.restrictedContributionsCount;
  const stats = [
    ['TOTAL CONTRIB', String(calendar.totalContributions)],
    ...(priv > 0 ? [['OFF THE BOOKS', String(priv)]] : []),
    ['ACTIVE DAYS', String(activeDays)],
    ['PEAK / 24H', String(busiest.count)],
    ['PEAK DATE', busiest.date],
  ];
  const cellW = (W - M * 2) / stats.length;
  const cells = stats
    .map(([label, value], i) => {
      const x = M + i * cellW;
      // The peak date is a full ISO date, too long for the display face at the
      // size the counts use, so it drops to the mono face at a smaller size.
      const wide = value.length > 8;
      return `<rect x="${fmt(x)}" y="128" width="${fmt(cellW - 16)}" height="2" fill="${C.cyan}" opacity="0.5"/>` +
        `<text class="mono" x="${fmt(x)}" y="148" font-size="13" fill="${C.cyan}" letter-spacing="1.2">${label}</text>` +
        (wide
          ? `<text class="mono" x="${fmt(x)}" y="178" font-size="17" fill="${C.yellow}" letter-spacing="0.5">${esc(value)}</text>`
          : `<text class="display" x="${fmt(x)}" y="180" font-size="30" fill="${C.yellow}" letter-spacing="1">${esc(value)}</text>`);
    })
    .join('\n');

  return panel(W, H, `${username} contribution activity, 7-day average, ${range}`, `
${ticks.map((t) => `<line x1="${fmt(t.x)}" y1="${PAD.top - 12}" x2="${fmt(t.x)}" y2="${baseline}" stroke="${C.grid}" stroke-width="1" opacity="0.6"/>`).join('\n')}
${glitch(username.toUpperCase(), { x: M, y: 70, size: 42 })}
<rect x="${M}" y="84" width="170" height="3" fill="${C.yellow}"/>
<text class="mono" x="${M}" y="110" font-size="13" fill="${C.cyan}" letter-spacing="1.2">CONTRIBUTION ACTIVITY &lt;&gt; 7-DAY AVG</text>
<rect x="${W - 232}" y="36" width="200" height="16" fill="url(#hazard)" opacity="0.85"/>
<text class="mono" x="${W - M}" y="80" font-size="14" fill="${C.yellow}" text-anchor="end" letter-spacing="1">${esc(range)}</text>
<text class="mono" x="${W - M}" y="108" font-size="12" fill="${C.muted}" text-anchor="end" letter-spacing="0.5">SYS://GITHUB.CONTRIB.CAL &gt;&gt; ONLINE</text>
<circle cx="${W - 268}" cy="104" r="4" fill="${C.magenta}">
<animate attributeName="opacity" values="1;1;0.15;0.15" keyTimes="0;0.5;0.55;1" dur="1.8s" repeatCount="indefinite"/>
</circle>
${cells}
${grid}
<line x1="${PAD.left}" y1="${baseline}" x2="${W - PAD.right}" y2="${baseline}" stroke="${C.cyan}" stroke-width="1" opacity="0.55"/>
<path d="${area}" fill="url(#areaFill)"/>
<path d="${line}" fill="none" stroke="${C.magenta}" stroke-width="2.5" opacity="0.55" transform="translate(-2.5,2)"/>
<path d="${line}" fill="none" stroke="${C.cyan}" stroke-width="2.5" opacity="0.5" transform="translate(2.5,-2)"/>
<path id="trace" d="${line}" fill="none" stroke="url(#lineStroke)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
<circle r="7" fill="${C.yellow}" opacity="0.28" filter="url(#glow)">
<animateMotion dur="14s" repeatCount="indefinite" rotate="0"><mpath href="#trace"/></animateMotion>
</circle>
<circle r="3.2" fill="${C.void}" stroke="${C.yellow}" stroke-width="2">
<animateMotion dur="14s" repeatCount="indefinite" rotate="0"><mpath href="#trace"/></animateMotion>
</circle>
${scanSweep('plotScan', PAD.left, PAD.top - 12, plotW, plotH + 12, { dur: '9s', band: 240, opacity: 0.11 })}
${ticks.map((t) => `<text class="mono" x="${fmt(t.x)}" y="${baseline + 26}" font-size="13" fill="${C.muted}" text-anchor="middle" letter-spacing="0.5">${t.label}</text>`).join('\n')}
<text class="mono" x="${M}" y="${H - 18}" font-size="12" fill="${C.muted}" letter-spacing="1">CONTRIBUTIONS/DAY &lt;&gt; 7-DAY ROLLING AVERAGE</text>
`, `
<linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${C.yellow}" stop-opacity="0.42"/>
<stop offset="60%" stop-color="${C.yellow}" stop-opacity="0.10"/>
<stop offset="100%" stop-color="${C.yellow}" stop-opacity="0"/>
</linearGradient>
<linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="${C.cyan}"/>
<stop offset="45%" stop-color="${C.yellow}"/>
<stop offset="100%" stop-color="${C.yellow}"/>
</linearGradient>`);
}

/**
 * Breach Protocol: the game's quickhack minigame, driven by real contribution data.
 *
 * This replaces the contribution snake, which depended on a third-party action
 * pushing a rendered SVG to a separate branch. The matrix is the trailing 26
 * weeks of the contribution calendar -- one hex code per day, its tile lit by
 * that day's count -- and the highlighted path is a genuine breach solve walked
 * over that data: the cursor starts on the top row, and from then on alternates
 * between picking the busiest unvisited day in its column and in its row, which
 * is the alternating row/column rule the game enforces. The buffer fills with
 * the codes it collects and the daemons report what the window adds up to.
 */
function breach() {
  const W = CANVAS;
  const H = 490;
  const ROWS = 7;
  const CODES = ['1C', '55', 'BD', 'E9', '7A', 'FF'];
  const STEPS = 8;
  const STEP = 0.62;
  const HOLD = 2.3;
  const TOTAL = STEPS * STEP + HOLD;

  // Whole weeks only, so every column is a real Sunday-to-Saturday week.
  const WEEKS = 26;
  const tail = days.slice(-(WEEKS * ROWS));
  const cols = Math.floor(tail.length / ROWS);
  const cells = Array.from({ length: cols }, (_, c) =>
    Array.from({ length: ROWS }, (_, r) => tail[c * ROWS + r])
  );

  const pitch = (W - M * 2) / cols;
  const cell = fmt(pitch - 5);
  const top = 140;
  const xOf = (c) => fmt(M + c * pitch);
  const yOf = (r) => fmt(top + r * pitch);

  const peakCount = Math.max(...tail.map((d) => d.count), 1);
  const levelOf = (n) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / peakCount) * 3.999)));
  const TILE_OPACITY = [0.16, 0.3, 0.45, 0.65, 0.9];
  const codeOf = (c, r) => CODES[(c * 31 + r * 7 + cells[c][r].count * 13) % CODES.length];

  // The solve. Rule of the game: the first pick comes from the top row, then
  // the cursor alternates between choosing within its column and within its
  // row. Ties and empty days are fine -- it simply walks toward the busy ones.
  const seen = new Set();
  const key = (c, r) => `${c},${r}`;
  const best = (candidates) =>
    candidates
      .filter(([c, r]) => !seen.has(key(c, r)))
      .sort((a, b) => cells[b[0]][b[1]].count - cells[a[0]][a[1]].count)[0];

  const path = [];
  let cursor = best(Array.from({ length: cols }, (_, c) => [c, 0]));
  for (let i = 0; i < STEPS && cursor; i++) {
    path.push(cursor);
    seen.add(key(cursor[0], cursor[1]));
    const [c, r] = cursor;
    cursor = i % 2 === 0
      ? best(Array.from({ length: ROWS }, (_, rr) => [c, rr]))
      : best(Array.from({ length: cols }, (_, cc) => [cc, r]));
  }

  // Fade a decoration in at the step it belongs to and hold it to the loop end.
  const atStep = (i, extra = '') => {
    const t = fmt((i * STEP) / TOTAL);
    return `<animate attributeName="opacity" values="0;0;1;1;0" ` +
      `keyTimes="0;${t};${fmt(t + 0.012)};0.96;1" dur="${fmt(TOTAL)}s" repeatCount="indefinite"${extra}/>`;
  };

  const grid = cells
    .flatMap((col, c) =>
      col.map((day, r) => {
        const lv = levelOf(day.count);
        const fill = lv >= 3 ? C.void : lv >= 1 ? C.text : '#2E4C55';
        return `<rect x="${xOf(c)}" y="${yOf(r)}" width="${cell}" height="${cell}" fill="${RAMP[lv]}" opacity="${TILE_OPACITY[lv]}"/>` +
          `<text class="mono" x="${fmt(M + c * pitch + (pitch - 5) / 2)}" y="${fmt(top + r * pitch + (pitch - 5) / 2 + 5)}" ` +
          `font-size="13" fill="${fill}" text-anchor="middle">${codeOf(c, r)}</text>`;
      })
    )
    .join('\n');

  const trail = path
    .map(([c, r], i) =>
      `<rect x="${xOf(c)}" y="${yOf(r)}" width="${cell}" height="${cell}" fill="none" stroke="${C.yellow}" stroke-width="2" opacity="0">${atStep(i)}</rect>`
    )
    .join('\n');

  // One reticle that jumps between picks, rather than one per cell.
  const keyTimes = path.map((_, i) => fmt((i * STEP) / TOTAL)).concat('1').join(';');
  const positions = path.map(([c, r]) => `${xOf(c)},${yOf(r)}`).concat(
    path.length ? `${xOf(path[path.length - 1][0])},${yOf(path[path.length - 1][1])}` : '0,0'
  ).join(';');
  const arm = fmt(Number(cell) / 3);
  const reticle = `<g opacity="0.95">
<animateTransform attributeName="transform" type="translate" values="${positions}" keyTimes="${keyTimes}" calcMode="discrete" dur="${fmt(TOTAL)}s" repeatCount="indefinite"/>
<path d="M0 ${arm}V0h${arm}M${cell} ${arm}V0h-${arm}M0 ${fmt(Number(cell) - Number(arm))}v${arm}h${arm}M${cell} ${fmt(Number(cell) - Number(arm))}v${arm}h-${arm}" fill="none" stroke="${C.magenta}" stroke-width="3"/>
</g>`;

  // Buffer: eight slots, filling with the codes the solve collects.
  const slotW = 40;
  const slotGap = 6;
  const SLOTS = 8;
  const bufX = W - M - (SLOTS * slotW + (SLOTS - 1) * slotGap);
  const buffer = Array.from({ length: SLOTS }, (_, i) => {
    const x = bufX + i * (slotW + slotGap);
    const pick = path[i];
    return `<rect x="${x}" y="72" width="${slotW}" height="32" fill="none" stroke="${C.grid}" stroke-width="1.5"/>` +
      (pick
        ? `<text class="mono" x="${x + slotW / 2}" y="${94}" font-size="15" fill="${C.yellow}" text-anchor="middle" opacity="0">${codeOf(pick[0], pick[1])}${atStep(i)}</text>`
        : '');
  }).join('\n');

  // Month ticks under the matrix, one per month the window covers.
  const ticks = [];
  let lastMonth = null;
  cells.forEach((col, c) => {
    const m = col[0].date.slice(0, 7);
    if (m !== lastMonth) {
      lastMonth = m;
      ticks.push(`<text class="mono" x="${fmt(M + c * pitch + (pitch - 5) / 2)}" y="${fmt(top + ROWS * pitch + 22)}" font-size="13" fill="${C.muted}" text-anchor="middle" letter-spacing="0.5">${monthLabel(col[0].date)}</text>`);
    }
  });

  const total = tail.reduce((t, d) => t + d.count, 0);
  const active = tail.filter((d) => d.count > 0).length;
  let streak = 0;
  let longest = 0;
  for (const d of tail) {
    streak = d.count > 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }

  const daemons = [
    ['DATAMINE_V1', `${total} CONTRIBUTIONS`],
    ['DATAMINE_V2', `${active} ACTIVE DAYS`],
    ['DATAMINE_V3', `${longest} DAY STREAK`],
  ];
  const dW = (W - M * 2) / daemons.length;
  const daemonRow = daemons
    .map(([name, value], i) => {
      const x = M + i * dW;
      // Each daemon lands as the solve reaches its third of the buffer.
      const step = i * 3 + 2;
      return `<rect x="${fmt(x)}" y="410" width="${fmt(dW - 18)}" height="2" fill="${C.cyan}" opacity="0.5"/>` +
        `<text class="mono" x="${fmt(x)}" y="434" font-size="14" fill="${C.cyan}" letter-spacing="1.5">${name}</text>` +
        `<text class="display" x="${fmt(x)}" y="468" font-size="24" fill="${C.yellow}">${esc(value)}</text>` +
        `<text class="mono" x="${fmt(x + dW - 22)}" y="434" font-size="12" fill="${C.muted}" text-anchor="end">PENDING` +
        `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${fmt((step * STEP) / TOTAL)};${fmt((step * STEP) / TOTAL + 0.012)};1" dur="${fmt(TOTAL)}s" repeatCount="indefinite"/></text>` +
        `<text class="mono" x="${fmt(x + dW - 22)}" y="434" font-size="12" fill="${C.yellow}" text-anchor="end" opacity="0">INSTALLED${atStep(step)}</text>`;
    })
    .join('\n');

  return panel(W, H, `${username} breach protocol, ${cols} week contribution matrix`, `
${glitch('BREACH PROTOCOL', { x: M, y: 68, size: 36 })}
<rect x="${M}" y="82" width="230" height="3" fill="${C.yellow}"/>
<text class="mono" x="${M}" y="112" font-size="13" fill="${C.cyan}" letter-spacing="1.2">CODE MATRIX &lt;&gt; LAST ${cols} WEEKS &lt;&gt; ONE CODE PER DAY</text>
<text class="mono" x="${W - M}" y="60" font-size="13" fill="${C.cyan}" text-anchor="end" letter-spacing="1.5">BUFFER ${SLOTS}/${SLOTS}</text>
${buffer}
${grid}
${trail}
${reticle}
${scanSweep('matrixScan', M, top, W - M * 2, ROWS * pitch, { dur: '6.5s', band: 240, opacity: 0.13 })}
${ticks.join('\n')}
${daemonRow}
`);
}

/** Closing strip. */
function footer() {
  const W = CANVAS;
  const H = 110;
  return panel(W, H, 'end of line', `
<rect x="${M}" y="28" width="${W - M * 2}" height="14" fill="url(#hazard)" opacity="0.75"/>
<text class="display" x="${M}" y="84" font-size="30" fill="${C.yellow}" letter-spacing="2">END OF LINE</text>
<text class="mono" x="${W - M}" y="84" font-size="12" fill="${C.muted}" text-anchor="end" letter-spacing="1">GENERATED DAILY &lt;&gt; ALL GRAPHS SELF-HOSTED</text>
`);
}

/** POSTs with a few backoff retries on network errors, 5xx, and rate limiting. */
async function fetchWithRetry(url, options, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= attempts;
    try {
      const res = await fetch(url, options);
      if (last || (res.status < 500 && res.status !== 429)) return res;
      console.warn(`Attempt ${attempt} got HTTP ${res.status}, retrying...`);
    } catch (error) {
      if (last) throw error;
      console.warn(`Attempt ${attempt} failed (${error.message}), retrying...`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

/**
 * Catmull-Rom through every point, converted to cubic beziers. Control points
 * are clamped to the plot band: a cubic bezier stays inside the convex hull of
 * its control points, which is what stops a spike-then-drop from overshooting
 * the curve below the zero line.
 */
function smoothPath(pts, yTop, yBottom) {
  if (pts.length < 2) return `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  const clamp = (y) => Math.min(yBottom, Math.max(yTop, y));
  let d = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C ${fmt(c1[0])} ${fmt(c1[1])}, ${fmt(c2[0])} ${fmt(c2[1])}, ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

/** Smallest 1/2/5-times-a-power-of-ten value that is >= `value`. */
function niceStep(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

function monthLabel(date) {
  // Three letters only. The ticks sit about 60px apart, which a "JAN 2025"
  // label would overrun; the year is already printed in the range readout.
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return names[Number(date.split('-')[1]) - 1];
}
