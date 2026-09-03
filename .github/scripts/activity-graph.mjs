#!/usr/bin/env node
/**
 * Renders a contribution activity graph as a self-contained SVG.
 *
 * This replaces the third-party github-readme-activity-graph service, whose
 * public deployment is disabled (HTTP 402), by generating the same kind of
 * chart from the GitHub GraphQL API and committing it into the repository.
 *
 * Env:
 *   GITHUB_TOKEN  token used for the GraphQL call (the workflow's default token is enough)
 *   USERNAME      login to chart
 *   OUTPUT        output path (default: assets/activity-graph.svg)
 */

const token = process.env.GITHUB_TOKEN;
const username = process.env.USERNAME;
const output = process.env.OUTPUT || 'assets/activity-graph.svg';

if (!token) throw new Error('GITHUB_TOKEN is required');
if (!username) throw new Error('USERNAME is required');

const QUERY = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const to = new Date();
const from = new Date(to);
from.setUTCFullYear(from.getUTCFullYear() - 1);
from.setUTCDate(from.getUTCDate() + 1);

// A transient 5xx or secondary rate limit would otherwise fail the workflow and
// throw away the 3D graphs regenerated in the step before this one.
const response = await fetchWithRetry('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'activity-graph-generator',
  },
  body: JSON.stringify({
    query: QUERY,
    variables: { login: username, from: from.toISOString(), to: to.toISOString() },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL API returned ${response.status}: ${await response.text()}`);
}

const payload = await response.json();
if (payload.errors) {
  throw new Error(`GitHub GraphQL API errors: ${JSON.stringify(payload.errors)}`);
}

const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
if (!calendar) throw new Error(`No contribution calendar returned for "${username}"`);

// The calendar is week-aligned, so the first and last weeks can reach outside the
// requested range. Days past today would come back as zeros and draw a cliff at
// the right edge, so clip to the window we actually asked for.
const fromDay = from.toISOString().slice(0, 10);
const toDay = to.toISOString().slice(0, 10);
const days = calendar.weeks
  .flatMap((week) => week.contributionDays)
  .filter((day) => day.date >= fromDay && day.date <= toDay)
  .map((day) => ({ date: day.date, count: day.contributionCount }))
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

if (days.length === 0) throw new Error(`Empty contribution calendar for "${username}"`);

// A trailing 7-day average keeps the line readable without hiding real spikes,
// and avoids the partial-week dips a weekly bucketing would introduce at both ends.
const WINDOW = 7;
const series = days.map((day, i) => {
  const start = Math.max(0, i - WINDOW + 1);
  const slice = days.slice(start, i + 1);
  const sum = slice.reduce((total, d) => total + d.count, 0);
  return { date: day.date, value: sum / slice.length };
});

const W = 1280;
const H = 360;
const PAD = { top: 104, right: 44, bottom: 48, left: 74 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const peak = Math.max(...series.map((p) => p.value));
const gridCount = 4;
// Size the gridline step first, then derive the axis max, so the labels land on
// round numbers and the plot keeps only a little headroom above the peak.
const gridStep = niceStep(peak / gridCount);
const yMax = gridStep * gridCount;

const xAt = (i) => PAD.left + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
const yAt = (v) => PAD.top + plotH - (yMax === 0 ? 0 : (v / yMax) * plotH);

const points = series.map((p, i) => [xAt(i), yAt(p.value)]);
const linePath = smoothPath(points, PAD.top, PAD.top + plotH);
const areaPath = `${linePath} L ${fmt(points[points.length - 1][0])} ${fmt(PAD.top + plotH)} L ${fmt(points[0][0])} ${fmt(PAD.top + plotH)} Z`;

// Horizontal gridlines, labelled with the contribution rate they represent.
const gridlines = Array.from({ length: gridCount + 1 }, (_, i) => {
  const value = gridStep * i;
  return { y: yAt(value), label: formatValue(value) };
});

// One tick per month boundary, so the axis reads as a calendar rather than an index.
const monthTicks = [];
let lastMonth = null;
series.forEach((p, i) => {
  const month = p.date.slice(0, 7);
  if (month !== lastMonth) {
    lastMonth = month;
    monthTicks.push({ x: xAt(i), label: monthLabel(p.date) });
  }
});

const busiest = days.reduce((best, d) => (d.count > best.count ? d : best), days[0]);
const activeDays = days.filter((d) => d.count > 0).length;
const rangeLabel = `${days[0].date} → ${days[days.length - 1].date}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${username} contribution activity, ${rangeLabel}`)}">
<title>${esc(`${username} — ${calendar.totalContributions} contributions between ${rangeLabel}`)}</title>
<defs>
<linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#39d353" stop-opacity="0.55"/>
<stop offset="100%" stop-color="#39d353" stop-opacity="0.02"/>
</linearGradient>
<linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#26a641"/>
<stop offset="50%" stop-color="#39d353"/>
<stop offset="100%" stop-color="#ffc837"/>
</linearGradient>
</defs>
<style>
text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
.title { fill: #eeeeff; font-size: 26px; font-weight: 600; }
.meta { fill: #8b949e; font-size: 15px; }
.stat-value { fill: #ffc837; font-size: 21px; font-weight: 700; }
.stat-label { fill: #8b949e; font-size: 15px; }
.axis { fill: #6e7681; font-size: 13px; }
.grid { stroke: #21262d; stroke-width: 1; }
</style>
<rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#00000f"/>
<text class="title" x="${PAD.left}" y="46">${esc(username)}</text>
<text class="meta" x="${W - PAD.right}" y="46" text-anchor="end">${esc(rangeLabel)}</text>
${statLine()}
${gridlines
  .map(
    (g) =>
      `<line class="grid" x1="${PAD.left}" y1="${fmt(g.y)}" x2="${W - PAD.right}" y2="${fmt(g.y)}"/>` +
      `<text class="axis" x="${PAD.left - 12}" y="${fmt(g.y + 4)}" text-anchor="end">${g.label}</text>`
  )
  .join('\n')}
<path d="${areaPath}" fill="url(#area)"/>
<path d="${linePath}" fill="none" stroke="url(#line)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
${monthTicks
  .map((t) => `<text class="axis" x="${fmt(t.x)}" y="${PAD.top + plotH + 26}" text-anchor="middle">${t.label}</text>`)
  .join('\n')}
</svg>
`;

const { writeFile, mkdir } = await import('node:fs/promises');
const { dirname } = await import('node:path');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, svg, 'utf8');
console.log(`Wrote ${output} — ${calendar.totalContributions} contributions, ${rangeLabel}`);

function statLine() {
  const stats = [
    [String(calendar.totalContributions), 'contributions'],
    [String(activeDays), 'active days'],
    [String(busiest.count), `best day (${busiest.date})`],
  ];
  // One <text> with tspans lets the renderer advance the cursor, so the stats
  // stay aligned without guessing glyph widths.
  const spans = stats
    .map(([value, label], i) =>
      `<tspan class="stat-value"${i === 0 ? '' : ' dx="28"'}>${esc(value)}</tspan>` +
      `<tspan class="stat-label" dx="8">${esc(label)}</tspan>`
    )
    .join('');
  return `<text x="${PAD.left}" y="80">${spans}</text>`;
}

/**
 * Catmull-Rom through every point, converted to cubic beziers.
 *
 * Control points are clamped to [yTop, yBottom]. A cubic bezier stays inside the
 * convex hull of its control points, so clamping is what keeps a spike-then-drop
 * from overshooting the curve below the zero line and out of the plot area.
 */
function smoothPath(pts, yTop, yBottom) {
  if (pts.length < 2) return `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  const clampY = (y) => Math.min(yBottom, Math.max(yTop, y));
  let d = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clampY(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clampY(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C ${fmt(c1[0])} ${fmt(c1[1])}, ${fmt(c2[0])} ${fmt(c2[1])}, ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
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
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

/** Smallest 1/2/5-times-a-power-of-ten value that is >= `value`. */
function niceStep(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function formatValue(value) {
  return value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
}

function monthLabel(date) {
  const [year, month] = date.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = names[Number(month) - 1];
  return month === '01' ? `${name} ${year}` : name;
}

function fmt(n) {
  return Number(n.toFixed(2));
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
