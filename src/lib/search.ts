/**
 * Accent- and case-insensitive text matching shared by the search filter and
 * the typeahead ("zurich" finds "Zürich", "societe" finds "Société").
 */

/** lower-case, strip combining marks */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Split `text` into [before, match, after] around the first occurrence of the
 * folded query, for highlighting. Null if there's no match, or if folding
 * changed the text's length (so indices wouldn't line up).
 */
export function splitMatch(text: string, foldedQuery: string): [string, string, string] | null {
  if (!foldedQuery) return null;
  const f = fold(text);
  if (f.length !== text.length) return null;
  const at = f.indexOf(foldedQuery);
  if (at < 0) return null;
  return [text.slice(0, at), text.slice(at, at + foldedQuery.length), text.slice(at + foldedQuery.length)];
}

/** rank: 0 = matches at the start, 1 = at a word start, 2 = anywhere, -1 = no match */
export function matchRank(folded: string, foldedQuery: string): number {
  const at = folded.indexOf(foldedQuery);
  if (at < 0) return -1;
  if (at === 0) return 0;
  return /[\s\-'"«“(/]/.test(folded[at - 1]) ? 1 : 2;
}
