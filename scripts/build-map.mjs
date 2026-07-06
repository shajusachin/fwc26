#!/usr/bin/env node
/**
 * build-map.mjs — one-off builder for map.json (the Host Cities map).
 *
 * Produces a self-contained, dependency-free North America outline (USA +
 * Canada + Mexico) plus the projected screen coordinates of all 16 host
 * stadiums, so the runtime needs NO map library, tiles, or API keys.
 *
 * Source outline: Natural Earth 1:110m admin-0 countries (public domain),
 * fetched from the nvkelso/natural-earth-vector mirror.
 *
 * Projection: standard Web-Mercator, then a linear "fit" transform derived
 * from the bounding box of the 16 stadiums (+ padding) so the continental
 * host area fills the viewBox and far-north Canada / Alaska simply clip off
 * the edges.
 *
 * Run:  node scripts/build-map.mjs
 */
import { writeFileSync } from 'node:fs';

const GEO = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const W = 900, H = 640, PAD = 74;

// venue -> { lon, lat, city }  (city = FIFA host-city label)
const VENUES = {
  "Azteca":                 { lon:-99.1505,  lat:19.3029, city:"Mexico City" },
  "AKRON":                  { lon:-103.4625, lat:20.6817, city:"Guadalajara" },
  "Estadio BBVA":           { lon:-100.2444, lat:25.6692, city:"Monterrey" },
  "BMO Field":              { lon:-79.4185,  lat:43.6332, city:"Toronto" },
  "BC Place":               { lon:-123.1118, lat:49.2768, city:"Vancouver" },
  "SoFi Stadium":           { lon:-118.3392, lat:33.9535, city:"Los Angeles" },
  "Levi's Stadium":         { lon:-121.9700, lat:37.4030, city:"San Francisco" },
  "MetLife Stadium":        { lon:-74.0745,  lat:40.8135, city:"New York / NJ" },
  "Gillette Stadium":       { lon:-71.2643,  lat:42.0909, city:"Boston" },
  "NRG Stadium":            { lon:-95.4107,  lat:29.6847, city:"Houston" },
  "AT&T Stadium":           { lon:-97.0945,  lat:32.7473, city:"Dallas" },
  "Lincoln Financial Field":{ lon:-75.1675,  lat:39.9008, city:"Philadelphia" },
  "Mercedes-Benz Stadium":  { lon:-84.4006,  lat:33.7553, city:"Atlanta" },
  "Lumen Field":            { lon:-122.3316, lat:47.5952, city:"Seattle" },
  "Hard Rock Stadium":      { lon:-80.2389,  lat:25.9580, city:"Miami" },
  "Arrowhead Stadium":      { lon:-94.4839,  lat:39.0489, city:"Kansas City" }
};

// Web-Mercator to unit space [0..1]
const merc = (lon, lat) => {
  const x = (lon + 180) / 360;
  const s = Math.sin(lat * Math.PI / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
};

// Fit transform from the 16 stadium points (+ padding)
const pts = Object.values(VENUES).map(v => merc(v.lon, v.lat));
const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
const minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
const sx = (W - 2 * PAD) / (maxX - minX);
const sy = (H - 2 * PAD) / (maxY - minY);
const scale = Math.min(sx, sy); // keep geographic aspect ratio
// centre within the viewBox
const offX = PAD + ((W - 2 * PAD) - (maxX - minX) * scale) / 2 - minX * scale;
const offY = PAD + ((H - 2 * PAD) - (maxY - minY) * scale) / 2 - minY * scale;
const project = (lon, lat) => {
  const [ux, uy] = merc(lon, lat);
  return [ux * scale + offX, uy * scale + offY];
};

const r1 = n => Math.round(n * 10) / 10;

// Build an SVG path from a GeoJSON polygon/multipolygon, dropping rings that
// fall entirely outside a generous margin around the viewBox (clips Arctic).
function ringsToPath(coordsList) {
  const M = 400; // generous margin so coastlines meeting the edge still draw
  let d = '';
  for (const ring of coordsList) {
    const projd = ring.map(([lon, lat]) => project(lon, lat));
    // skip rings wholly off-canvas
    const inBox = projd.some(([x, y]) => x > -M && x < W + M && y > -M && y < H + M);
    if (!inBox) continue;
    d += 'M' + projd.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L') + 'Z';
  }
  return d;
}

function geomToPaths(geom) {
  const out = [];
  if (geom.type === 'Polygon') {
    const d = ringsToPath(geom.coordinates);
    if (d) out.push(d);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      const d = ringsToPath(poly);
      if (d) out.push(d);
    }
  }
  return out;
}

const main = async () => {
  const res = await fetch(GEO);
  if (!res.ok) throw new Error('geojson fetch failed: ' + res.status);
  const gj = await res.json();
  const want = new Set(['United States of America', 'Canada', 'Mexico']);
  const land = [];
  for (const f of gj.features) {
    if (!want.has(f.properties.ADMIN)) continue;
    land.push(...geomToPaths(f.geometry));
  }

  const dots = {};
  for (const [venue, v] of Object.entries(VENUES)) {
    const [x, y] = project(v.lon, v.lat);
    dots[venue] = { x: r1(x), y: r1(y), city: v.city };
  }

  const outObj = {
    source: 'Natural Earth 1:110m (public domain) via nvkelso/natural-earth-vector',
    projection: 'Web Mercator, fit to host-stadium bounds',
    w: W, h: H,
    land,
    dots
  };
  writeFileSync(new URL('../map.json', import.meta.url), JSON.stringify(outObj));
  const bytes = JSON.stringify(outObj).length;
  console.log(`map.json written · ${land.length} land paths · ${Object.keys(dots).length} dots · ${(bytes/1024).toFixed(1)} KB`);
  // sanity: all dots inside viewBox?
  const bad = Object.entries(dots).filter(([, d]) => d.x < 0 || d.x > W || d.y < 0 || d.y > H);
  console.log(bad.length ? 'OUT OF BOUNDS: ' + bad.map(b => b[0]).join(', ') : 'all dots within viewBox ✓');
};
main().catch(e => { console.error(e); process.exit(1); });
