/*
 * build-squads.mjs — one-off (re-runnable) builder for real WC2026 squads.
 *
 * Source: Wikipedia "2026 FIFA World Cup squads" — the canonical, structured
 * dataset. Every player is a {{nat fs g player}} template with real fields:
 * shirt number, position (GK/DF/MF/FW), name, caps, int'l goals, club.
 *
 * Positions are broad ROLE only (GK/DF/MF/FW). Wikipedia squad lists do NOT
 * encode exact positions (LB/CB/RB), starting XIs or formations — and no free
 * source does — so we store role only and the UI places players in role bands.
 * No fabricated data.
 *
 * Output: squads.json  { source, url, updated, teams: { <appName>: [players] } }
 *
 * Run:  node scripts/build-squads.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '2026_FIFA_World_Cup_squads';
const WIKI = `https://en.wikipedia.org/w/api.php?action=parse&page=${PAGE}&prop=wikitext&format=json&formatversion=2`;

// Wikipedia team name -> app team name (only where they differ).
const NAME_MAP = {
  'Czech Republic': 'Czechia',
  'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
  'DR Congo': 'Congo DR',
  'Cape Verde': 'Cape Verde Islands',
  "Côte d'Ivoire": 'Ivory Coast',
  'Türkiye': 'Turkey',
};

function cleanLinks(s) {
  return (s || '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1') // [[A|B]]->B, [[A]]->A
    .replace(/\{\{[^}]*\}\}/g, '')                    // drop stray templates
    .replace(/<ref[^>]*>.*?<\/ref>/gs, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function field(line, key, nextKeys) {
  const stop = nextKeys.map(k => `\\|${k}=`).join('|');
  const re = new RegExp(`\\|${key}=(.*?)(?:${stop}|\\}\\})`, 's');
  const m = line.match(re);
  return m ? m[1] : '';
}

const POS_BAND = { GK: 'GK', DF: 'DF', MF: 'MF', FW: 'FW' };

function parsePlayer(line) {
  const no = cleanLinks(field(line, 'no', ['pos', 'name']));
  const posRaw = cleanLinks(field(line, 'pos', ['name', 'sortname'])).toUpperCase();
  const name = cleanLinks(field(line, 'name', ['sortname', 'age', 'caps', 'club']));
  const caps = cleanLinks(field(line, 'caps', ['goals', 'club', 'clubnat']));
  const goals = cleanLinks(field(line, 'goals', ['club', 'clubnat']));
  const club = cleanLinks(field(line, 'club', ['clubnat', 'nat']));
  const pos = POS_BAND[posRaw] || posRaw || '';
  if (!name) return null;
  return {
    no: no ? Number(no) : null,
    pos,
    name,
    caps: caps !== '' ? Number(caps) : null,
    goals: goals !== '' ? Number(goals) : null,
    club: club || null,
  };
}

async function main() {
  console.log('Fetching Wikipedia squads…');
  const res = await fetch(WIKI, { headers: { 'User-Agent': 'wc2026-squads-builder' } });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const doc = await res.json();
  const wt = doc.parse.wikitext;

  // Split the page into (=== Team ===) blocks. Team headers are level-3;
  // group headers are level-2 (==Group X==) which we skip.
  const teams = {};
  const parts = wt.split(/\n===\s*([^=]+?)\s*===\n/);
  // parts[0] is preamble; then alternating [heading, body, heading, body, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    const body = parts[i + 1] || '';
    const lines = body.split('\n').filter(l => /\{\{nat fs g player/.test(l));
    if (!lines.length) continue; // not a squad section
    const players = lines.map(parsePlayer).filter(Boolean);
    if (!players.length) continue;
    const appName = NAME_MAP[heading] || heading;
    teams[appName] = players;
  }

  const order = ['GK', 'DF', 'MF', 'FW'];
  for (const t of Object.keys(teams)) {
    teams[t].sort((a, b) => {
      const pa = order.indexOf(a.pos), pb = order.indexOf(b.pos);
      if (pa !== pb) return pa - pb;
      return (a.no ?? 99) - (b.no ?? 99);
    });
  }

  const out = {
    source: 'Wikipedia — 2026 FIFA World Cup squads',
    url: `https://en.wikipedia.org/wiki/${PAGE}`,
    license: 'CC BY-SA 4.0 (factual data)',
    updated: new Date().toISOString(),
    note: 'Positions are broad role only (GK/DF/MF/FW). Exact positions, starting XIs and formations are not encoded in the source and are never fabricated.',
    teams,
  };
  await writeFile(join(ROOT, 'squads.json'), JSON.stringify(out, null, 0));
  const names = Object.keys(teams).sort();
  console.log(`Wrote squads.json — ${names.length} teams, ${Object.values(teams).reduce((n, a) => n + a.length, 0)} players`);
  console.log('Teams:', names.join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
