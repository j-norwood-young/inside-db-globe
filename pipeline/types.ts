/** Shared types + reference data for the data pipeline. */

export interface NormalizedStory {
  url: string;
  headline: string;
  outlet: string;
  /** ISO 3166-1 alpha-2, or undefined for language-only rows. */
  country?: string;
  /** ISO 639-1. */
  language: string;
  /** epoch ms, UTC */
  publishedAt: number;
  snippet: string;
}

export type GeoBasis = 'country' | 'outlet' | 'language';

export interface Story {
  id: string;
  url: string;
  headline: string;
  snippet: string;
  outlet: string;
  language: string;
  country?: string;
  lat: number;
  lon: number;
  publishedAt: number;
  geoBasis: GeoBasis;
}

export interface BuildMeta {
  windowStart: number;
  windowEnd: number;
  total: number;
  languages: Record<string, number>;
  countries: Record<string, number>;
  languagesCovered: string[];
  generatedAt: number;
}

export interface CityPoint {
  city: string;
  lat: number;
  lon: number;
}

export const COUNTRY_NAMES: Record<string, string> = {
  Germany: 'DE',
  Italy: 'IT',
  France: 'FR',
  Austria: 'AT',
  Switzerland: 'CH',
  Brazil: 'BR',
  Spain: 'ES',
  Russia: 'RU',
  Mexico: 'MX',
  Argentina: 'AR',
  Netherlands: 'NL',
  Belgium: 'BE',
  Portugal: 'PT',
  Canada: 'CA',
  India: 'IN',
  'South Africa': 'ZA',
  Kenya: 'KE',
  'United Kingdom': 'GB',
  Japan: 'JP',
  'United Arab Emirates': 'AE',
  Greece: 'GR',
  Australia: 'AU',
  Egypt: 'EG',
  Poland: 'PL',
  Turkey: 'TR',
  Finland: 'FI',
};

export const KNOWN_LANGUAGES = new Set([
  'en', 'de', 'es', 'fr', 'it', 'ru', 'pt', 'ar', 'zh', 'nl', 'ja',
  'cs', 'da', 'el', 'et', 'hu', 'id', 'ko', 'lt', 'ms', 'tr', 'uk',
]);

/** FNV-1a 32-bit hash of a string. Deterministic across runs. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random float in [0, 1) derived from string inputs. */
export function seededRandom(...parts: string[]): number {
  return fnv1a(parts.join('\u0001')) / 0x100000000;
}

/** Short stable id (8 hex chars) derived from a URL. */
export function idFromUrl(url: string): string {
  const a = fnv1a(url).toString(16).padStart(8, '0');
  const b = fnv1a('\u0001' + url).toString(16).padStart(8, '0');
  return (a + b).slice(0, 8);
}
