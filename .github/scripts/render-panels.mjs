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
import { C, RAMP, loadFonts, fontCss, sharedDefs, corners, glitch, scanlines, heading, fmt, esc } from './lib/theme.mjs';

const token = process.env.GITHUB_TOKEN;
const username = process.env.USERNAME;
const outDir = process.env.OUT_DIR || 'assets';

if (!token) throw new Error('GITHUB_TOKEN is required');
if (!username) throw new Error('USERNAME is required');

// No date range: this is GitHub's default trailing-year calendar, the same
// window github-profile-3d-contrib uses, so every panel reports one period.
const QUERY = `
  query ($login: String!) {
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
  body: JSON.stringify({ query: QUERY, variables: { login: username } }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL API returned ${response.status}: ${await response.text()}`);
}
const payload = await response.json();
if (payload.errors) throw new Error(`GitHub GraphQL API errors: ${JSON.stringify(payload.errors)}`);

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
const forks = user.repositories.nodes.reduce((s, r) => s + r.forkCount, 0);
const languages = new Set(user.repositories.nodes.flatMap((r) => r.languages.nodes.map((l) => l.name)));
const busiest = days.reduce((best, d) => (d.count > best.count ? d : best), days[0]);
const activeDays = days.filter((d) => d.count > 0).length;
const range = `${days[0].date} / ${days[days.length - 1].date}`;

const fonts = await loadFonts();
await mkdir(outDir, { recursive: true });

await write('hero.svg', hero());
await write('attributes.svg', attributes());
await write('activity-graph.svg', activityGraph());
await write('footer.svg', footer());

console.log(`Rendered 4 panels for ${username} — ${calendar.totalContributions} contributions, ${range}`);

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
  const W = 1280;
  const H = 300;
  const display = (user.name || user.login).toUpperCase();
  const rows = [
    ['CLASS', 'NETRUNNER'],
    ['SPEC', 'ARTIFICIAL INTELLIGENCE'],
    ['STATUS', 'JACKED IN'],
  ];
  const info = rows
    .map(([k, v], i) => {
      const y = 150 + i * 34;
      return `<text class="mono" x="${W - 372}" y="${y}" font-size="14" fill="${C.muted}" letter-spacing="1.5">${k}</text>` +
        `<text class="mono" x="${W - 44}" y="${y}" font-size="15" fill="${C.cyan}" text-anchor="end" letter-spacing="1.5">${esc(v)}</text>` +
        `<rect x="${W - 372}" y="${y + 10}" width="328" height="1" fill="${C.grid}"/>`;
    })
    .join('\n');

  return panel(W, H, `${display} — netrunner profile`, `
<rect x="44" y="52" width="360" height="20" fill="url(#hazard)" opacity="0.85"/>
${glitch(display, { x: 44, y: 138, size: 62 })}
<rect x="44" y="156" width="300" height="3" fill="${C.yellow}"/>
<text class="mono" x="44" y="192" font-size="18" fill="${C.cyan}" letter-spacing="2">@${esc(user.login)}</text>
<text class="display" x="44" y="230" font-size="26" fill="${C.text}" letter-spacing="2">ONLY THE BEST SURVIVE</text>
<text class="mono" x="44" y="258" font-size="13" fill="${C.muted}" letter-spacing="1.5">SCALABLE SYSTEMS &lt;&gt; AI RESEARCH &lt;&gt; OPEN TO COLLAB</text>
${info}
`);
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
  const W = 1280;
  const H = 560;
  const LEVELS = 20;

  const attrs = [
    ['TECHNICAL ABILITY', 'DISTINCT LANGUAGES SHIPPED', languages.size, 20],
    ['INTELLIGENCE', 'STARS EARNED ON OWN WORK', stars, 1000],
    ['REFLEXES', 'ACTIVE DAYS THIS YEAR', activeDays, 365],
    ['COOL', 'REVIEWS GIVEN ON OTHERS\' CODE', cc.totalPullRequestReviewContributions, 500],
    ['BODY', 'REPOS CONTRIBUTED TO', user.repositoriesContributedTo.totalCount, 100],
  ];
  const level = (v, ref) =>
    Math.max(1, Math.min(LEVELS, Math.round(1 + (LEVELS - 1) * (Math.log10(v + 1) / Math.log10(ref + 1)))));

  const segW = 30;
  const gap = 4;
  const barX = 386;

  const rows = attrs
    .map(([name, source, value, ref], i) => {
      const y = 156 + i * 60;
      const lv = level(value, ref);
      const bar = Array.from({ length: LEVELS }, (_, sIdx) => {
        const on = sIdx < lv;
        const colour = !on ? '#101820' : sIdx >= LEVELS - 3 ? C.yellow : C.cyan;
        return `<rect x="${barX + sIdx * (segW + gap)}" y="${y - 16}" width="${segW}" height="19" fill="${colour}" opacity="${on ? 1 : 0.55}"/>`;
      }).join('');
      return `<text class="display" x="44" y="${y}" font-size="25" fill="${C.text}" letter-spacing="1">${name}</text>` +
        `<text class="mono" x="44" y="${y + 19}" font-size="11" fill="${C.muted}" letter-spacing="1.2">${source}</text>` +
        bar +
        `<text class="display" x="${W - 44}" y="${y}" font-size="27" fill="${C.yellow}" text-anchor="end">LV ${lv}</text>` +
        `<text class="mono" x="${W - 44}" y="${y + 19}" font-size="11" fill="${C.muted}" text-anchor="end" letter-spacing="1.2">${value}</text>`;
    })
    .join('\n');

  const creds = [
    ['STREET CRED', user.followers.totalCount, 'FOLLOWERS'],
    ['EDDIES', stars, 'STARS'],
    ['FORKS', forks, 'OF YOUR WORK'],
    ['REPOS', user.repositories.totalCount, 'OWNED, NON-FORK'],
  ];
  const credW = (W - 88) / creds.length;
  const credRow = creds
    .map(([label, value, sub], i) => {
      const x = 44 + i * credW;
      return `<rect x="${fmt(x)}" y="${H - 116}" width="${fmt(credW - 20)}" height="2" fill="${C.cyan}" opacity="0.5"/>` +
        `<text class="mono" x="${fmt(x)}" y="${H - 96}" font-size="12" fill="${C.cyan}" letter-spacing="1.5">${label}</text>` +
        `<text class="display" x="${fmt(x)}" y="${H - 62}" font-size="30" fill="${C.yellow}">${value}</text>` +
        `<text class="mono" x="${fmt(x)}" y="${H - 42}" font-size="10" fill="${C.muted}" letter-spacing="1.2">${sub}</text>`;
    })
    .join('\n');

  return panel(W, H, `${user.login} attributes`, `
${heading('ATTRIBUTES', { x: 44, y: 64, rule: 200 })}
<text class="mono" x="${W - 44}" y="64" font-size="13" fill="${C.muted}" text-anchor="end" letter-spacing="1.5">LEVEL / 20 &lt;&gt; LOG-SCORED VS REFERENCE CEILING</text>
<line x1="44" y1="96" x2="${W - 44}" y2="96" stroke="${C.grid}" stroke-width="1"/>
${rows}
${credRow}
`);
}

/** The contribution rate over the trailing year, as a HUD readout. */
function activityGraph() {
  const W = 1280;
  const H = 470;
  const PAD = { top: 208, right: 64, bottom: 74, left: 74 };
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
      `<text class="mono" x="${PAD.left - 14}" y="${fmt(y + 4)}" font-size="12" fill="${C.muted}" text-anchor="end">${(gridStep * i).toFixed(decimals)}</text>`;
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

  const stats = [
    ['TOTAL CONTRIB', String(calendar.totalContributions)],
    ['ACTIVE DAYS', String(activeDays)],
    ['PEAK / 24H', String(busiest.count)],
    ['PEAK DATE', busiest.date],
  ];
  const cellW = (W - 88) / stats.length;
  const cells = stats
    .map(([label, value], i) => {
      const x = 44 + i * cellW;
      return `<rect x="${fmt(x)}" y="132" width="${fmt(cellW - 18)}" height="2" fill="${C.cyan}" opacity="0.5"/>` +
        `<text class="mono" x="${fmt(x)}" y="152" font-size="12" fill="${C.cyan}" letter-spacing="1.5">${label}</text>` +
        `<text class="display" x="${fmt(x)}" y="186" font-size="30" fill="${C.yellow}" letter-spacing="1">${esc(value)}</text>`;
    })
    .join('\n');

  return panel(W, H, `${username} contribution activity, 7-day average, ${range}`, `
${ticks.map((t) => `<line x1="${fmt(t.x)}" y1="${PAD.top - 12}" x2="${fmt(t.x)}" y2="${baseline}" stroke="${C.grid}" stroke-width="1" opacity="0.6"/>`).join('\n')}
${glitch(username.toUpperCase(), { x: 44, y: 72, size: 52 })}
<rect x="44" y="86" width="196" height="3" fill="${C.yellow}"/>
<text class="mono" x="44" y="112" font-size="14" fill="${C.cyan}" letter-spacing="1.5">// CONTRIBUTION ACTIVITY &lt;&gt; 7-DAY AVG</text>
<rect x="${W - 292}" y="40" width="248" height="18" fill="url(#hazard)" opacity="0.85"/>
<text class="mono" x="${W - 44}" y="82" font-size="15" fill="${C.yellow}" text-anchor="end" letter-spacing="1">${esc(range)}</text>
<text class="mono" x="${W - 44}" y="108" font-size="12" fill="${C.muted}" text-anchor="end" letter-spacing="1">SYS://GITHUB.CONTRIB.CAL &gt;&gt; ONLINE</text>
${cells}
${grid}
<line x1="${PAD.left}" y1="${baseline}" x2="${W - PAD.right}" y2="${baseline}" stroke="${C.cyan}" stroke-width="1" opacity="0.55"/>
<path d="${area}" fill="url(#areaFill)"/>
<path d="${line}" fill="none" stroke="${C.magenta}" stroke-width="2.5" opacity="0.55" transform="translate(-2.5,2)"/>
<path d="${line}" fill="none" stroke="${C.cyan}" stroke-width="2.5" opacity="0.5" transform="translate(2.5,-2)"/>
<path d="${line}" fill="none" stroke="url(#lineStroke)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
${ticks.map((t) => `<text class="mono" x="${fmt(t.x)}" y="${baseline + 26}" font-size="12" fill="${C.muted}" text-anchor="middle" letter-spacing="1">${t.label}</text>`).join('\n')}
<text class="mono" x="44" y="${H - 18}" font-size="11" fill="${C.grid}" letter-spacing="1">CONTRIBUTIONS/DAY // 7-DAY ROLLING AVERAGE</text>
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

/** Closing strip. */
function footer() {
  const W = 1280;
  const H = 120;
  return panel(W, H, 'end of line', `
<rect x="44" y="30" width="${W - 88}" height="14" fill="url(#hazard)" opacity="0.75"/>
<text class="display" x="44" y="88" font-size="30" fill="${C.yellow}" letter-spacing="2">END OF LINE</text>
<text class="mono" x="${W - 44}" y="88" font-size="13" fill="${C.muted}" text-anchor="end" letter-spacing="1.5">GENERATED DAILY // NO EXTERNAL SERVICES</text>
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
  const [year, month] = date.split('-');
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return month === '01' ? `${names[Number(month) - 1]} ${year}` : names[Number(month) - 1];
}
