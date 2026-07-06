# ⚽ FIFA World Cup 2026 — Live Schedule & Scores

A fast, single-page web app for following the **2026 FIFA World Cup** — full match
schedule, live scores, group standings, top scorers, and the knockout bracket — all
in **your local timezone**, with team flags, host-city profiles, and live weather at
each stadium.

> **▶️ Open the live site:** **https://shajusachin.github.io/fwc26/**
>
> No install, no login — just open the link in any browser on phone, tablet, or desktop.

---

## ✨ What you can do

| Feature | What it gives you |
| --- | --- |
| 📅 **Full schedule** | Every match, grouped by day, with a **"Today's matches"** jump arrow |
| 🌍 **Your timezone** | Pick any timezone — all kickoff times convert instantly |
| 🔎 **Filters** | Filter by **team**, **group**, or **host city** |
| 📊 **Standings** | Live group tables, including **Best Third-Place Teams** |
| 👟 **Top scorers** | The Golden Boot race, updated with the data feed |
| 👥 **Squads** | Every team's official 26-player squad on a football pitch, placed by role (GK/DEF/MID/FWD) — tap any player for club, caps &amp; age |
| 🏆 **Knockout bracket** | Round of 32 → Final, neatly aligned on one screen |
| 🏟 **Host Cities** | An interactive **map of North America** — click any city dot for stadium facts, total matches, live weather, and a jump to its matches |
| 📱 **Match details** | Tap any finished match for a full timeline — real goals (scorer + minute) |
| 🔗 **Share links** | Every filtered view has its own URL (e.g. `?team=Brazil`) you can copy and share |
| 🖨 **Print mode** | A clean, printer-friendly layout |

---

## 🚀 How to use it

1. Go to **https://shajusachin.github.io/fwc26/**
2. Set your **timezone** in the top bar (it defaults to your device's zone).
3. Browse the schedule, or use the tabs to switch to **Standings**, **Scorers**,
   **Host Cities**, or the **Knockout** bracket.
4. **Hover** (desktop) or **tap** (mobile) a host-city card to see stadium stats and
   live weather.
5. Want to share a specific view? Apply your filters and hit **Share** — it copies a
   direct link to your clipboard.

---

## 🔄 Is the data live?

Yes. The page ships with a recent snapshot baked in (so it always loads instantly,
even offline), then fetches the **latest feed** in the background:

- A scheduled **GitHub Action** (`.github/workflows/refresh-data.yml`) runs every few
  minutes, pulls fresh match data, and commits it back to the repo.
- The page polls that feed — **every 1 minute while matches are live**, every 5
  minutes otherwise — and updates scores, standings, and scorers in place.
- A status pill in the header shows whether you're seeing **live** or **snapshot** data.

Stadium weather is fetched on demand from a free, key-free weather API when you open a
host-city card.

---

## 🛠 Run it locally (optional)

You only need [Node.js](https://nodejs.org/) (v18+). No build step, no dependencies.

```bash
# clone the repo
git clone https://github.com/shajusachin/fwc26.git
cd fwc26

# start a tiny local server
node scripts/serve.mjs
# → open http://localhost:8099/
```

> Opening `index.html` directly as a `file://` works too, but serving over `http://`
> lets the live data + weather fetches behave exactly like the hosted site.

### Refresh the data yourself

```bash
# rebuild the runtime feed from the existing raw files (no network needed):
node scripts/refresh.mjs

# pull genuinely fresh data from the provider (needs a free API token):
FOOTBALL_DATA_TOKEN=your_token node scripts/refresh.mjs
```

Get a free token at [football-data.org](https://www.football-data.org/). To enable the
automated refresh on your own fork, add the token as a repository secret named
`FOOTBALL_DATA_TOKEN` (**Settings → Secrets and variables → Actions**).

---

## 📁 Project layout

```
index.html              The entire app — one self-contained page
data-compact.json       Runtime feed the page fetches (fixtures + scorers + details)
squads.json             Official 26-player squads for all 48 teams (role-tagged)
map.json                North America map outline + stadium dot coordinates (Host Cities tab)
*-embed.js              Baked-in fallback snapshot (loads instantly / offline)
data.json, scorers.json, match-details.json, fixtures.json   Raw, human-readable data
scripts/refresh.mjs     Builds the feed (live from the API, or offline from raw files)
scripts/build-squads.mjs  One-off builder for squads.json (parses Wikipedia squads)
scripts/build-map.mjs   One-off builder for map.json (projects Natural Earth outline + stadium coords)
scripts/serve.mjs       Minimal local static server
.github/workflows/      Scheduled data-refresh + GitHub Pages deploy Actions
```

---

## 🙏 Credits & attribution

- **Match & scorer data:** [football-data.org](https://www.football-data.org/)
- **Squad rosters:** [Wikipedia — 2026 FIFA World Cup squads](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads) (CC BY-SA)
- **Team flags:** [flagcdn.com](https://flagcdn.com/)
- **Live stadium weather:** [Open-Meteo](https://open-meteo.com/)
- **Map outline:** [Natural Earth](https://www.naturalearthdata.com/) (public domain)
- **Original inspiration:** the excellent
  [**Kingdoggydog/worldcup2026**](https://github.com/Kingdoggydog/worldcup2026)
  project — the OG that sparked this build.

---

## 📝 About

A personal passion project — built and maintained by **Shaju** for the love of the
game and as part of learning the art of Vibe Coding and GitHub Copilot. Contributions,
ideas, and bug reports are welcome via Issues.

**Disclaimer:** This is an unofficial fan-made project. It is **not affiliated with,
endorsed by, or associated with FIFA** or any official World Cup body. All team and
competition names belong to their respective owners.

## © Copyright

Copyright © 2026 shajusachin. **All Rights Reserved.** See [COPYRIGHT](COPYRIGHT).

This repository is public for viewing only. No part may be copied, forked, or
reused without prior written permission.
