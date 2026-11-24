/**
 * Colour-blind-safe categorical palette (Okabe–Ito base, extended for 11
 * languages). One fixed colour per language across globe, legend, histogram
 * and stats.
 */
export const LANG_COLORS: Record<string, string> = {
  en: '#56b4e9', // sky blue
  de: '#e69f00', // orange
  es: '#009e73', // bluish green
  fr: '#0072b2', // blue
  it: '#f0e442', // yellow
  ru: '#d55e00', // vermillion
  pt: '#cc79a7', // reddish purple/pink
  ar: '#9c9c9c', // grey
  zh: '#ff0000', // red
  nl: '#8f7fd6', // muted purple
  ja: '#66e0d0' // teal
};

export const LANG_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ru: 'Russian',
  pt: 'Portuguese',
  ar: 'Arabic',
  zh: 'Chinese',
  nl: 'Dutch',
  ja: 'Japanese'
};

export const langColor = (lang: string): string => LANG_COLORS[lang] ?? '#9c9c9c';

/** [r,g,b] in 0..1 for shader use */
export function langColorRGB(lang: string): [number, number, number] {
  const hex = langColor(lang);
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
