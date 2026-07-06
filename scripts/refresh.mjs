#!/usr/bin/env node
/**
 * Refresh World Cup 2026 data.
 *
 * Data sources (both 100% real — no simulated/fabricated data):
 *   - football-data.org  → fixtures, final scores, aggregate top-scorers.
 *       (Free tier gives scores only; it returns NO per-match goal events.)
 *   - openfootball/world-cup.json → real per-match goals (scorer + minute +
 *       penalty/own-goal flags) and half-time scores. Free, no key, GitHub CDN.
 *
 * Two modes:
 *   - LIVE  (FOOTBALL_DATA_TOKEN set): pull fresh fixtures + scorers from
 *           football-data.org, overlay real goals from openfootball.
 *   - LOCAL (no token): re-transform the existing raw data.json + scorers.json,
 *           still overlaying openfootball goals. Lets you build without a token.
 *
 * Outputs (all relative to the repo root = this script's parent dir):
 *   data.json, scorers.json                          (raw football-data)
 *   openfootball-2026.json                            (raw openfootball cache)
 *   fixtures-embed.js, scorers-embed.js, details-embed.js   (in-page fallback)
 *   data-compact.json                                 (runtime feed the page fetches)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
const API = 'https://api.football-data.org/v4';
const COMP = '2000';      // FIFA World Cup
const SEASON = '2026';
const OPENFOOTBALL_URL = 'https://raw.githubusercontent.com/openfootball/world-cup.json/master/2026/worldcup.json';

const p = (...a) => join(ROOT, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Static venue fallback: football-data.org's free tier dropped the `venue`
   field, so the schedule renders TBD. World Cup venues are fixed by the FIFA
   schedule, so we keep a stable id→venue map (scripts/venues.json). */
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

/* ── TEAM-NAME MATCHING (football-data ↔ openfootball) ───── */
const stripDia = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = s => stripDia(s).toLowerCase().replace(/[^a-z]/g, '');
// football-data name → openfootball name (both normalized). Only the handful
// that differ; everything else matches after diacritic-stripping.
const ALIAS = {
  capeverdeislands: 'capeverde',
  congodr: 'drcongo',
  czechia: 'czechrepublic',
  unitedstates: 'usa',
};
const canon = s => { const n = norm(s); return ALIAS[n] || n; };
const pairKey = (h, a) => `${canon(h)}|${canon(a)}`;

/* ── OPENFOOTBALL (real per-match goals) ────────────────── */
async function loadOpenfootball() {
  try {
    const res = await fetch(OPENFOOTBALL_URL, { headers: { 'User-Agent': 'wc2026-refresh' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    await writeFile(p('openfootball-2026.json'), JSON.stringify(json, null, 0));
    console.log(`  openfootball: ${json.matches?.length ?? 0} matches (fresh)`);
    return json;
  } catch (e) {
    console.warn(`  openfootball fetch failed (${e.message}) — using cached copy`);
    return readJSON('openfootball-2026.json', { matches: [] });
  }
}

// index openfootball matches by canonical home|away team pair
function indexOpenfootball(of) {
  const idx = {};
  for (const m of (of.matches || [])) {
    if (m.team1 && m.team2) idx[pairKey(m.team1, m.team2)] = m;
  }
  return idx;
}

// map one openfootball match to our compact goal-event list (real data only).
// openfootball lists goals under the BENEFICIARY team (goals1=home, goals2=away).
// Our display keys a goal by the SCORER's team, with own-goals counting for the
// opponent — so an own goal is stored under the scorer's (conceding) side.
function mapGoals(om, homeName, awayName) {
  const out = [];
  const toMin = v => { const n = parseInt(String(v), 10); return Number.isFinite(n) ? n : 0; };
  const add = (g, beneficiary, other) => {
    const own = !!g.owngoal;
    out.push({
      m: toMin(g.minute),
      t: own ? other : beneficiary,      // scorer's team
      s: g.name || '',
      a: null,                            // openfootball has no assist data
      ty: g.penalty ? 'PENALTY' : (own ? 'OWN' : 'REGULAR'),
    });
  };
  (om.goals1 || []).forEach(g => add(g, homeName, awayName));
  (om.goals2 || []).forEach(g => add(g, awayName, homeName));
  out.sort((x, y) => x.m - y.m);
  return out;
}

/* ── LIVE FETCH (football-data) ─────────────────────────── */
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

  return { matchesDoc, scorersDoc };
}

/* ── TRANSFORM (raw → compact) ──────────────────────────── */
function toCompact({ matchesDoc, scorersDoc, ofData }) {
  const fixtures = (matchesDoc.matches || []).map(m => {
    const sc = m.score || {};
    const ft = sc.fullTime || {};
    let hs = ft.home ?? null, as = ft.away ?? null, pen = null;
    // football-data bundles the shootout into fullTime for penalty knockouts.
    // Show the on-pitch score (regulation + extra time) so it matches the goal
    // events, and expose the shootout tally separately.
    if (sc.duration === 'PENALTY_SHOOTOUT' && sc.penalties) {
      const reg = sc.regularTime || {}, et = sc.extraTime || {};
      hs = (reg.home ?? 0) + (et.home ?? 0);
      as = (reg.away ?? 0) + (et.away ?? 0);
      pen = { h: sc.penalties.home, a: sc.penalties.away };
    }
    return {
      id: m.id, u: m.utcDate, s: m.status, v: m.venue || VENUES[m.id] || 'TBD',
      st: m.stage, g: m.group || null,
      h: m.homeTeam?.name ?? null, a: m.awayTeam?.name ?? null,
      hs, as, w: sc.winner ?? null,
      ...(pen ? { pen } : {})
    };
  });

  const scorers = (scorersDoc.scorers || []).map(s => ({
    n: s.player?.name, t: s.team?.name, nat: s.player?.nationality,
    g: s.goals ?? 0, a: s.assists ?? null, pm: s.playedMatches ?? 0
  }));

  // Overlay real per-match goals from openfootball, matched by team pair.
  const ofIdx = indexOpenfootball(ofData);
  const details = {};
  let matched = 0; const unmatchedFinished = [];
  for (const m of (matchesDoc.matches || [])) {
    const home = m.homeTeam?.name, away = m.awayTeam?.name;
    if (!home || !away) continue;
    const om = ofIdx[pairKey(home, away)];
    if (!om) {
      if (m.status === 'FINISHED') unmatchedFinished.push(`${home} v ${away}`);
      continue;
    }
    const g = mapGoals(om, home, away);
    const ht = (om.score && Array.isArray(om.score.ht))
      ? { home: om.score.ht[0], away: om.score.ht[1] } : null;
    if (g.length || ht) { details[m.id] = { g, ht }; matched++; }
  }
  console.log(`  goal overlay: ${matched} matches matched to openfootball`);
  if (unmatchedFinished.length)
    console.warn(`  ${unmatchedFinished.length} finished matches had no openfootball goals: ${unmatchedFinished.slice(0, 6).join('; ')}${unmatchedFinished.length > 6 ? '…' : ''}`);

  return { fixtures, scorers, details };
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
    };
  }
  raw.ofData = await loadOpenfootball();
  await writeOutputs(toCompact(raw));
  console.log('done.');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
