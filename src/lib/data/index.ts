import storiesRaw from '../../../data/build/stories.json';
import metaRaw from '../../../data/build/meta.json';
import { LANG_COLORS } from '../stories/palette';

export type GeoBasis = 'country' | 'outlet' | 'language';

export interface Story {
  id: string;
  url: string;
  headline: string;
  snippet: string;
  outlet: string;
  language: string; // ISO 639-1
  country?: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
  publishedAt: number; // epoch ms UTC
  geoBasis: GeoBasis;
}

export interface Meta {
  windowStart: number;
  windowEnd: number;
  total: number;
  languages: Record<string, number>;
  countries: Record<string, number>;
  languagesCovered: string[];
  generatedAt: number;
}

export interface LoadedData {
  stories: Story[]; // sorted by publishedAt ascending
  meta: Meta;
  windowStart: number;
  windowEnd: number;
}

function load(): LoadedData {
  const stories = (storiesRaw as unknown as Story[]).slice().sort(
    (a, b) => a.publishedAt - b.publishedAt
  );
  const meta = metaRaw as unknown as Meta;
  const windowStart = Math.min(meta.windowStart, ...stories.map((s) => s.publishedAt));
  const windowEnd = Math.max(meta.windowEnd, ...stories.map((s) => s.publishedAt));
  return { stories, meta, windowStart, windowEnd };
}

export const DATA: LoadedData = load();
export { LANG_COLORS };
