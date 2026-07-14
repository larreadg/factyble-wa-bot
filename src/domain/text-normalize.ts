/** Lowercases, strips accents, collapses whitespace and trims — the shared normalization used to match menu options and global commands. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
