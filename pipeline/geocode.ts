/**
 * pipeline/geocode.ts
 *
 * 3-tier geocoding:
 *   1. country  — explicit country → curated city in that country
 *   2. outlet   — curated outlet HQ table
 *   3. language — representative city for the language (last resort: a guess,
 *                 so every outlet that reaches it should be added to the table)
 *
 * City picks are deterministic (FNV-1a hash of the outlet) with a small
 * ±0.2° jitter so clusters look organic but are stable across runs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fnv1a,
  seededRandom,
  type CityPoint,
  type GeoBasis,
  type NormalizedStory,
  type Story,
  idFromUrl,
} from './types.js';

function loadTable<T>(name: string): T {
  const path = fileURLToPath(new URL(`../data/tables/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const countryCities = loadTable<Record<string, CityPoint[]>>('country-cities.json');
const outletGeo = loadTable<Record<string, { city?: string; lat: number; lon: number }>>('outlet-geo.json');
const languageHomes = loadTable<Record<string, CityPoint[]>>('language-homes.json');

const JITTER_DEG = 0.2;

/** Deterministic jitter in [-JITTER_DEG, +JITTER_DEG] from a key string. */
function jitter(key: string): number {
  return seededRandom('jitter', key) * 2 * JITTER_DEG - JITTER_DEG;
}

function place(point: CityPoint, key: string): { lat: number; lon: number } {
  return {
    lat: round4(point.lat + jitter(key + ':lat')),
    lon: round4(point.lon + jitter(key + ':lon')),
  };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function pickFrom(points: CityPoint[], key: string): CityPoint {
  return points[fnv1a(key) % points.length];
}

/** Geocodes a single normalized story, returning { lat, lon, geoBasis }. */
export function geocode(story: NormalizedStory): { lat: number; lon: number; geoBasis: GeoBasis } {
  // Tier 1: explicit country → curated city
  if (story.country) {
    const cities = countryCities[story.country];
    if (cities && cities.length > 0) {
      const p = place(pickFrom(cities, story.outlet), story.url);
      return { ...p, geoBasis: 'country' };
    }
  }
  // Tier 2: curated outlet HQ
  const outlet = outletGeo[story.outlet.trim().toLowerCase()];
  if (outlet) {
    const p = place({ city: outlet.city ?? story.outlet, lat: outlet.lat, lon: outlet.lon }, story.url);
    return { ...p, geoBasis: 'outlet' };
  }
  // Tier 3: language representative city
  const homes = languageHomes[story.language] ?? languageHomes.en;
  const p = place(pickFrom(homes, story.outlet), story.url);
  return { ...p, geoBasis: 'language' };
}

/**
 * Most monitoring snippets are just "<headline> <outlet>". Keep only text that
 * adds something, so the shipped JSON doesn't carry ~100 KB of duplicates.
 */
function extraSnippet(s: NormalizedStory): string {
  let t = s.snippet.trim();
  const h = s.headline.trim();
  const o = s.outlet.trim();
  if (t.startsWith(h)) t = t.slice(h.length).trim();
  if (o && t.endsWith(o)) t = t.slice(0, -o.length).trim();
  return t.length > 20 ? t : '';
}

/** Geocodes all stories into the final Story records. */
export function geocodeAll(stories: NormalizedStory[]): Story[] {
  return stories.map((s) => {
    const { lat, lon, geoBasis } = geocode(s);
    return {
      id: idFromUrl(s.url),
      url: s.url,
      headline: s.headline,
      snippet: extraSnippet(s),
      outlet: s.outlet,
      language: s.language,
      ...(s.country ? { country: s.country } : {}),
      lat,
      lon,
      publishedAt: s.publishedAt,
      geoBasis,
    };
  });
}
