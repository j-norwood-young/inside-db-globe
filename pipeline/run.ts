/**
 * pipeline/run.ts
 *
 * Orchestrates the M0 data pipeline:
 *   CSV → normalize (validate + dedupe) → geocode (3-tier) → data/build/{stories,meta}.json
 *
 * Deterministic: same input → same output (jitter/ids are pure functions of the URL).
 * Run with: pnpm build:data  (tsx pipeline/run.ts)
 */
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { geocodeAll } from './geocode.js';
import { normalize } from './normalize.js';
import type { BuildMeta, GeoBasis, Story } from './types.js';

const buildDir = fileURLToPath(new URL('../data/build/', import.meta.url));

function main(): void {
  const { stories: normalized, stats } = normalize();
  const stories = geocodeAll(normalized).sort(
    (a, b) => a.publishedAt - b.publishedAt || a.url.localeCompare(b.url),
  );

  // ---- meta -------------------------------------------------------------
  const languages: Record<string, number> = {};
  const countries: Record<string, number> = {};
  for (const s of stories) {
    languages[s.language] = (languages[s.language] ?? 0) + 1;
    if (s.country) countries[s.country] = (countries[s.country] ?? 0) + 1;
  }
  const meta: BuildMeta = {
    windowStart: stories[0].publishedAt,
    windowEnd: stories[stories.length - 1].publishedAt,
    total: stories.length,
    languages,
    countries,
    languagesCovered: Object.keys(languages).sort(),
    generatedAt: Date.now(),
  };

  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, 'stories.json'), JSON.stringify(stories, null, 2) + '\n');
  writeFileSync(join(buildDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  // ---- geo report -------------------------------------------------------
  const total = stories.length;
  const tiers: Record<GeoBasis, number> = { country: 0, outlet: 0, language: 0 };
  for (const s of stories) tiers[s.geoBasis]++;
  const pct = (n: number) => ((n / total) * 100).toFixed(1) + '%';

  console.log('=== inside-db-world-viz · geo report ===');
  console.log(`CSV rows in:            ${stats.rowsIn}`);
  console.log(`Invalid rows skipped:   ${stats.invalidSkipped}`);
  console.log(`Duplicates removed:     ${stats.duplicatesRemoved} (by URL, kept earliest)`);
  console.log(`Total stories out:      ${total}`);
  console.log('');
  console.log('Geocoding tiers:');
  console.log(`  country  (explicit country → curated city): ${tiers.country} (${pct(tiers.country)})`);
  console.log(`  outlet   (curated outlet HQ):              ${tiers.outlet} (${pct(tiers.outlet)})`);
  console.log(`  language (representative language city):   ${tiers.language} (${pct(tiers.language)})`);
  console.log(`  placed at a real outlet location:          ${tiers.country + tiers.outlet} (${pct(tiers.country + tiers.outlet)})`);
  const guessed = [...new Set(stories.filter((s) => s.geoBasis === 'language').map((s) => s.outlet))].sort();
  if (guessed.length > 0) {
    console.log('');
    console.log(`WARNING: ${guessed.length} outlets have no known location; add them to data/tables/outlet-geo.json:`);
    for (const o of guessed) console.log(`  ${JSON.stringify(o.trim().toLowerCase())}`);
  }
  console.log('');
  console.log('Top countries:');
  for (const [code, n] of Object.entries(countries)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)) {
    console.log(`  ${code}  ${n}  (${pct(n)})`);
  }
  console.log(`  ... ${Object.keys(countries).length} countries total`);
  console.log('');
  console.log('Languages covered (' + meta.languagesCovered.length + '):');
  for (const [code, n] of Object.entries(languages)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${code}  ${n}  (${pct(n)})`);
  }
  console.log('');
  console.log(`Window: ${new Date(meta.windowStart).toISOString()} → ${new Date(meta.windowEnd).toISOString()}`);
  console.log(`Wrote data/build/stories.json (${total} stories) + data/build/meta.json`);
}

main();
