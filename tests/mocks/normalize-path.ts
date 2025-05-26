/**
 * Makes an Obsidian-safe, vault-relative path.
 *
 * Mutations performed (in order):
 *   1. Convert all back-slashes to forward slashes
 *   2. Collapse runs of “//” into a single “/”
 *   3. Trim a single leading “/” (or “\”) and a trailing “/” so the result
 *      is always vault-relative and never ends with a slash
 *   4. Replace non-breaking spaces ( ) with normal spaces
 *   5. Canonicalise the string with Unicode NFC
 */
export function normalizePath(path: string): string {
  if (typeof path !== "string") {
    throw new TypeError("normalizePath expects a string");
  }

  // 1 & 2. Slash unification + deduplication
  let p = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");

  // 3. Strip single leading or trailing slash
  p = p.replace(/^\/|\/$/g, "");

  // 4. Visibleise hard-space characters
  p = p.replace(/\u00A0/g, " ");

  // 5. Unicode normalisation
  return p.normalize("NFC");
}
