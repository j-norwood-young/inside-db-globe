# Inside Deutsche Bank — World Coverage Globe

A full-screen 3D globe that replays how news of the "Inside Deutsche Bank" leak spread
around the world: 1,546 stories in 22 languages, each appearing at its publication time
(UTC) on a realistic day/night Earth, over a 9.2-day window (16–25 Nov 2026).

SvelteKit 5 + TypeScript + three.js, built as a single static page.

## Running it

```sh
pnpm install
pnpm dev          # http://localhost:6778 (bound to 0.0.0.0, hot reload)
pnpm check        # svelte-check / TypeScript
pnpm build        # static site → build/
pnpm preview      # serve build/ on :6778
pnpm build:data   # re-run the data pipeline (data/stories.csv → data/build/*.json)
```

Set `PUBLIC_SITE_URL` (no trailing slash, e.g. `PUBLIC_SITE_URL=https://example.org pnpm build`)
when building for deployment: it makes the canonical link, social-card image, structured
data, `robots.txt` and `sitemap.xml` absolute. Without it they fall back to relative URLs,
which some share previews (Facebook, LinkedIn) ignore.

`data/build/*.json` is committed output of the pipeline and is imported directly by the
app, so `pnpm build` doesn't need to re-run the pipeline unless the CSV or tables change.

## Deploying

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`,
served at <https://globe.inside-db.com> (custom domain set in the repo's Pages settings;
DNS: `globe` CNAME → `j-norwood-young.github.io`). The workflow sets `PUBLIC_SITE_URL`.

The raw export (`data/stories.csv`) is not in the repo, so `pnpm build:data` needs it
copied in locally; the committed `data/build/*.json` is all the app build needs.

## Using it

- **Intro**: on load the whole window plays from the start, then rests at the end. Any
  play or scrub input stops it; ⏮ replays it from the start, ⏭ jumps to the end.
- **Time**: there is one playback rate — the whole 9.2-day window in 30 s (~7.4 sim-hours
  per second). space = play/pause (from the end it replays) ·
  drag the timeline to scrub. The histogram shows stories per 15 min, stacked by language.
- **Stories**: hover for the headline; click to fly in to the story at a tilt (dragging
  then orbits around it; scrolling or dragging cancels the flight) and open the detail
  card. In a busy place the stories there lift off into slowly turning satellite rings
  above it, each tethered to its plotted location; click any satellite, or pick from the
  card's list. Closing the card (or clicking off) lands them and flies back to exactly the
  view you had before the first click — hopping between stories or clusters keeps that
  view as the one to return to.
- **Prev/next**: ‹ › on the detail card step through stories in publication order
  ("12 of 1,546" — counting stories published so far that pass the filters). A step within
  the open cluster just moves the selection; anywhere else, the camera flies there.
- **Spin**: flick the globe sideways and it keeps turning about its axis, slowing over a
  few seconds; touch it or scroll to stop. (Off under reduced motion.)
- **Double-click / double-tap**: zoomed out → zoom in on that spot; zoomed in (or a story
  open) → close it and return to the starting zoom. Single clicks wait 250 ms so a
  double-click doesn't also select stories. (outlet, time, how the
  location was chosen, link to the article, and other stories at the same place).
- **Search**: a typeahead over outlets and headlines (case- and accent-insensitive, so
  "filtracion" finds "Filtración"). Typing filters the globe live; ↑/↓ + Enter or a click
  picks a suggestion — an outlet becomes an exact outlet filter (a removable chip), a
  headline flies to that story (moving time forward to it if it isn't published yet).
  Suggestions respect the language and country filters.
- **Filters**: clicking a language cycles: only that language → all languages except it →
  all languages ("show all" also resets). Filter by country. On phones the filters open as a bottom sheet.
- `prefers-reduced-motion` skips the intro and the idle camera drift.

## How it works

```
data/stories.csv ──pipeline/──▶ data/build/stories.json + meta.json ──import──▶ app
```

**Pipeline** (`pipeline/`, deterministic — same CSV, same output):
1. `normalize.ts` — splits `country_or_language` into country + language, validates
   dates/URLs, dedupes by URL.
2. `geocode.ts` — places each story using a three-tier rule, recorded per story as `geoBasis`:

   | Tier | Rule | Stories |
   |---|---|---|
   | `country` | Source named a country → one of 2–6 curated cities in it (`tables/country-cities.json`) | 586 (44%) |
   | `outlet` | Known outlet → its home city (`tables/outlet-geo.json`) | 462 (34%) |
   | `language` | Fallback → a representative city for the language (`tables/language-homes.json`); shown as *approx. location* | 293 (22%) |

   City picks and the small jitter that spreads a city's stories are pure functions of the
   outlet/URL, so positions are stable across runs. Snippets are kept only when they add
   text beyond the headline and outlet.

**App** (`src/lib/`):
- `time/clock.ts` — one simulated clock (`t`, `playing`) at a fixed rate (`PLAY_SPEED`); everything on screen
  is a pure function of `t`.
- `globe/sun.ts` — low-precision solar position (Meeus) → sun direction in Earth-fixed
  coordinates. The globe stays fixed in that frame and the terminator moves, so the
  day/night line is true for the simulated time. Convention: x = 0°, y = north, −z = 90°E.
- `globe/earth.ts` — day/night texture blend on the sun angle, city lights on the night
  side only, ocean glint from the specular map. Clouds, atmosphere rim and stars are
  separate meshes.
- `stories/storyLayer.ts` — three instanced meshes (dots, beams, ripples) animated
  entirely in shaders from a `uTime` uniform and a per-story start time; filters update
  one per-instance attribute. Dots keep a constant on-screen size.
- `stories/picking.ts` — ray-sphere hit + nearest stories within ~16 px; no GPU picking.
  Satellites are hit-tested first by projecting their positions with the same maths as
  the dot shader (`satelliteLayout`, `satellitePosition`).
- `ui/` — timeline + histogram, legend/filters, detail card, about/methodology modal.

Performance: 7 draw calls in total and a steady 60 fps (measured on desktop). Device
pixel ratio is capped at 2, and markers need no per-frame CPU work.

## Methodology caveats

- Timestamps come from the monitoring export and are taken as accurate UTC.
- Counting is per article: one wire story reprinted by many outlets counts each time.
- 22% of locations are inferred from language alone and are approximate; the country
  filter only covers stories whose source named a country.
- Only headlines, short snippets and links are shown — article text belongs to its publishers.

## Credits

- Earth textures (`static/textures/`): [Solar System Scope](https://www.solarsystemscope.com/textures/)
  by INOVE, based on NASA imagery, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: the 2k day, night,
  clouds, normal and specular maps were renamed, the TIFF normal/specular maps converted
  to JPEG, the clouds map recompressed, and the day map colour-graded in the
  shader (darker, less saturated, warmer land, deeper ocean — see `globe/earth.ts`). The same credit appears in the app's About box.
- Data: keyword monitoring export of the leak's coverage, 16–23 Nov 2026
  (`inside-db-news up to 23.11.25.xlsx` → `data/stories.csv`), plus 205 publishing-partner
  stories up to 25 Nov gathered from partner sites, RSS feeds and the consortium's story
  tracker (appended to the same CSV).

## Licence

The code is released under the [MIT Licence](LICENSE). This does not cover the Earth
textures in `static/textures/` (CC BY 4.0, see Credits) or the news data — headlines,
snippets and links belong to their publishers.
