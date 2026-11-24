/**
 * pipeline/normalize.ts
 *
 * Parses data/stories.csv, splits `country_or_language` into {country?, language},
 * validates dates/URLs, and dedupes by URL (keeps the earliest published_at).
 */
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { COUNTRY_NAMES, KNOWN_LANGUAGES, type NormalizedStory } from './types.js';

interface RawRow {
  published_at: string;
  headline: string;
  outlet: string;
  country_or_language: string;
  url: string;
  snippet: string;
}

const URL_RE = /^https?:\/\/\S+\.\S+/i;
/**
 * Splits a `country_or_language` value such as `Germany / de` or `en`
 * into { country?, language }. Throws on unresolvable input.
 */
export function splitCountryLanguage(
  raw: string,
): { country?: string; language: string } {
  const value = raw.trim();
  const slash = value.indexOf('/');
  let countryName: string | null = null;
  let lang: string;
  if (slash !== -1) {
    countryName = value.slice(0, slash).trim() || null;
    lang = value.slice(slash + 1).trim();
  } else {
    lang = value;
  }
  const language = lang.toLowerCase();
  if (!/^[a-z]{2}$/.test(language) || !KNOWN_LANGUAGES.has(language)) {
    throw new Error(`Unrecognized language code: ${JSON.stringify(raw)}`);
  }
  if (countryName) {
    const country = COUNTRY_NAMES[countryName];
    if (!country) {
      throw new Error(`Unrecognized country name: ${JSON.stringify(countryName)} (from ${JSON.stringify(raw)})`);
    }
    return { country, language };
  }
  return { language };
}

export interface NormalizeResult {
  stories: NormalizedStory[];
  stats: {
    rowsIn: number;
    invalidSkipped: number;
    duplicatesRemoved: number;
  };
}

/**
 * Reads and normalizes the raw CSV. Returns deduped, geocodable records.
 * `csvPath` defaults to data/stories.csv resolved relative to the repo root.
 */
export function normalize(csvPath: string = new URL('../data/stories.csv', import.meta.url).pathname): NormalizeResult {
  const text = readFileSync(csvPath, 'utf8');
  const raw = parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    cast: false,
  }) as RawRow[];

  let invalidSkipped = 0;
  const byUrl = new Map<string, NormalizedStory>();

  for (const row of raw) {
    if (!row) continue;
    const rec: RawRow = {
      published_at: row.published_at ?? '',
      headline: row.headline ?? '',
      outlet: row.outlet ?? '',
      country_or_language: row.country_or_language ?? '',
      url: row.url ?? '',
      snippet: row.snippet ?? '',
    };
    if (rec.published_at === 'country_or_language' || rec.published_at === '') continue; // stray header row

    const publishedAt = Date.parse(rec.published_at);
    if (!Number.isFinite(publishedAt)) {
      invalidSkipped++;
      continue;
    }
    if (!URL_RE.test(rec.url)) {
      invalidSkipped++;
      continue;
    }

    let story: NormalizedStory;
    try {
      const { country, language } = splitCountryLanguage(rec.country_or_language);
      story = {
        url: rec.url,
        headline: rec.headline,
        outlet: rec.outlet,
        ...(country ? { country } : {}),
        language,
        publishedAt,
        snippet: rec.snippet,
      };
    } catch (err) {
      invalidSkipped++;
      console.warn(`[normalize] skipping row: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const existing = byUrl.get(story.url);
    if (!existing) {
      byUrl.set(story.url, story);
    } else if (story.publishedAt < existing.publishedAt) {
      byUrl.set(story.url, story); // keep earliest publication
    }
  }

  const stories = [...byUrl.values()];
  return {
    stories,
    stats: {
      rowsIn: raw.length,
      invalidSkipped,
      duplicatesRemoved: raw.length - stories.length - invalidSkipped,
    },
  };
}
