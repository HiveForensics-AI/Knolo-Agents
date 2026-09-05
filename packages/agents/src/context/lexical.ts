const tokenPattern = /[a-z0-9]{2,}/g;

export function tokenize(text: string): readonly string[] {
  return (text.toLowerCase().match(tokenPattern) ?? []).slice();
}

export function lexicalScore(query: string, text: string): number {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return 0;
  const haystack = new Set(tokenize(text));
  let hits = 0;
  for (const term of terms) if (haystack.has(term)) hits += 1;
  return Math.round((hits / terms.length) * 1_000_000);
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isRedundant(candidate: string, selected: readonly string[]): boolean {
  const needle = normalizeText(candidate);
  if (!needle) return true;
  return selected.some(item => {
    const hay = normalizeText(item);
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}
