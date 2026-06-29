#!/usr/bin/env node
/**
 * Refresh World Cup 2026 data.
 *
 * Two modes:
 *   - LIVE  (FOOTBALL_DATA_TOKEN set): pull fresh data from football-data.org,
 *           write the raw files, then transform into the compact runtime feed.
 *   - LOCAL (no token): just re-transform the existing raw files into the
 *           compact feed + fallback embeds. Lets you build without network.
 *
 * Outputs (all relative to the repo root = this script's parent dir):
 *   data.json, scorers.json, match-details.json   (raw, human-inspectable)
 *   fixtures-embed.js, scorers-embed.js, details-embed.js   (in-page fallback)
 *   data-compact.json                               (runtime feed the page fetches)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
const API = 'https://api.football-data.org/v4';
const COMP = '2000';      // FIFA World Cup
const SEASON = '2026';
const FORCE = process.argv.includes('--force');

const p = (...a) => join(ROOT, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Static venue fallback: football-data.org's free tier dropped the `venue`
   field, so the schedule renders TBD. World Cup venues are fixed by the FIFA
   schedule, so we keep a stable id→venue map and use it whenever the API
   omits venue. (Lives in scripts/venues.json.) */
let VENUES = {};
try { VENUES = JSON.parse((await readFile(p('scripts/venues.json'), 'utf8'))); } catch { VENUES = {}; }

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(p(file), 'utf8')); }
  catch { return fallback; }
}

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-Auth-Token': TOKEN } });
  if (res.status === 429) { console.warn('  rate-limited, waiting 60s…'); await sleep(60000); return api(path); }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

/* ── LIVE FETCH ─────────────────────────────────────────── */
async function fetchLive() {
  console.log('LIVE mode — fetching from football-data.org');

  const matchesDoc = await api(`/competitions/${COMP}/matches?season=${SEASON}`);
  await writeFile(p('data.json'), JSON.stringify(matchesDoc, null, 0));
  console.log(`  matches: ${matchesDoc.matches?.length ?? 0}`);

  let scorersDoc = await readJSON('scorers.json', { scorers: [] });
  try {
    scorersDoc = await api(`/competitions/${COMP}/scorers?season=${SEASON}&limit=200`);
    await writeFile(p('scorers.json'), JSON.stringify(scorersDoc, null, 0));
    console.log(`  scorers: ${scorersDoc.scorers?.length ?? 0}`);
  } catch (e) { console.warn(`  scorers skipped: ${e.message}`); }

  // Details: only (re)fetch live matches and finished matches not already cached.
  const details = await readJSON('match-details.json', {});
  const needsDetail = (matchesDoc.matches || []).filter(m => {
    const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
    const finishedUncached = m.status === 'FINISHED' && (FORCE || !details[m.id]);
    return live || finishedUncached;
  });
  console.log(`  detail calls queued: ${needsDetail.length}`);

  let n = 0;
  for (const m of needsDetail) {
    try {
      const d = await api(`/matches/${m.id}`);
      details[m.id] = {
        status: d.status, minute: d.minute ?? null,
        score: d.score, goals: d.goals || [], bookings: d.bookings || [],
        substitutions: d.substitutions || []
      };
      n++;
    } catch (e) { console.warn(`  detail ${m.id} skipped: ${e.message}`); }
    await sleep(7000); // stay under free-tier 10 req/min
  }
  if (n) await writeFile(p('match-details.json'), JSON.stringify(details, null, 0));
  console.log(`  details updated: ${n}`);

  return { matchesDoc, scorersDoc, details };
}

/* ── TRANSFORM (raw → compact) ──────────────────────────── */
function toCompact({ matchesDoc, scorersDoc, details }) {
  const fixtures = (matchesDoc.matches || []).map(m => ({
    id: m.id, u: m.utcDate, s: m.status, v: m.venue || VENUES[m.id] || 'TBD',
    st: m.stage, g: m.group || null,
    h: m.homeTeam?.name ?? null, a: m.awayTeam?.name ?? null,
    hs: m.score?.fullTime?.home ?? null, as: m.score?.fullTime?.away ?? null,
    w: m.score?.winner ?? null
  }));

  const scorers = (scorersDoc.scorers || []).map(s => ({
    n: s.player?.name, t: s.team?.name, nat: s.player?.nationality,
    g: s.goals ?? 0, a: s.assists ?? null, pm: s.playedMatches ?? 0
  }));

  const compactDetails = {};
  for (const [id, d] of Object.entries(details || {})) {
    compactDetails[id] = {
      g: (d.goals || []).map(g => ({ m: g.minute, t: g.team?.name, s: g.scorer?.name, a: g.assist?.name ?? null, ty: g.type })),
      c: (d.bookings || []).map(b => ({ m: b.minute, t: b.team?.name, p: b.player?.name, c: b.card })),
      s: (d.substitutions || []).map(x => ({ m: x.minute, t: x.team?.name, in: x.playerIn?.name, out: x.playerOut?.name })),
      ht: d.score?.halfTime ?? null
    };
  }

  return { fixtures, scorers, details: compactDetails };
}

/* ── WRITE OUTPUTS ──────────────────────────────────────── */
async function writeOutputs({ fixtures, scorers, details }) {
  await writeFile(p('fixtures-embed.js'), `const FIXTURES = ${JSON.stringify(fixtures)};`);
  await writeFile(p('scorers-embed.js'), `const SCORERS = ${JSON.stringify(scorers)};`);
  await writeFile(p('details-embed.js'), `const DETAILS = ${JSON.stringify(details)};`);
  await writeFile(p('data-compact.json'), JSON.stringify({
    updated: new Date().toISOString(), fixtures, scorers, details
  }));
  console.log(`  wrote ${fixtures.length} fixtures, ${scorers.length} scorers, ${Object.keys(details).length} detail sets`);
}

/* ── MAIN ───────────────────────────────────────────────── */
(async () => {
  let raw;
  if (TOKEN) {
    raw = await fetchLive();
  } else {
    console.log('LOCAL mode — no token, transforming existing raw files');
    raw = {
      matchesDoc: await readJSON('data.json', { matches: [] }),
      scorersDoc: await readJSON('scorers.json', { scorers: [] }),
      details: await readJSON('match-details.json', {})
    };
  }
  await writeOutputs(toCompact(raw));
  console.log('done.');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
