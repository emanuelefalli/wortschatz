/** Shared text utilities: Unicode normalization, umlaut folding, edit distance. */

export function normalizeBasic(input: string): string {
  return input.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Lowercase with Unicode-aware handling (ß stays ß). */
export function lower(input: string): string {
  return input.toLocaleLowerCase("de-DE");
}

/** Fold ä/ö/ü/ß to ae/oe/ue/ss so both spellings compare equal. */
export function foldUmlauts(input: string): string {
  return input
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/ẞ/g, "SS");
}

export function hasUmlautSubstitution(given: string, expected: string): boolean {
  return given !== expected && foldUmlauts(given) === foldUmlauts(expected);
}

/** Strip punctuation that learners commonly add or omit (final period, quotes). */
export function stripPunctuation(input: string): string {
  return input.replace(/[.!?,;:"'„“”‘’()]/g, "").replace(/\s+/g, " ").trim();
}

/** Optimal string alignment (restricted Damerau–Levenshtein) distance. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Allowed typo budget for an "Almost" classification. */
export function typoBudget(expectedLength: number): number {
  if (expectedLength < 4) return 0;
  if (expectedLength < 8) return 1;
  return 2;
}
