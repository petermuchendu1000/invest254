/**
 * Cursor pagination primitives shared by the repository read methods. Cursors are opaque,
 * base64url-encoded tokens that the HTTP layer passes back verbatim — their internal format
 * is private to each repository (in-memory uses a monotonic sequence; Postgres uses a
 * keyset `(timestamp, id)`), so the two never need to agree on a wire format. All list
 * endpoints are newest-first and capped at MAX_PAGE_LIMIT.
 */
export interface PageQuery { limit?: number | undefined; cursor?: string | null | undefined; }
export interface Page<T> { items: T[]; nextCursor: string | null; }

export const DEFAULT_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 100;

/** Clamp a requested limit to (0, MAX_PAGE_LIMIT], defaulting when absent/invalid. */
export function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(limit), MAX_PAGE_LIMIT);
}

/** Encode an internal token into an opaque cursor. */
export function encodeCursor(token: string): string {
  return Buffer.from(token, "utf8").toString("base64url");
}

/** Decode an opaque cursor back to its internal token; null if absent or malformed (lenient). */
export function decodeCursor(cursor?: string | null): string | null {
  if (!cursor) return null;
  try {
    const t = Buffer.from(cursor, "base64url").toString("utf8");
    return t || null;
  } catch {
    return null;
  }
}

/** Keyset cursor for the Postgres repositories: `<createdAtMs>:<id>`. */
export interface KeysetCursor { tsMs: number; id: string; }

export function encodeKeyset(tsMs: number, id: string | number): string {
  return encodeCursor(`${tsMs}:${id}`);
}

export function decodeKeyset(cursor?: string | null): KeysetCursor | null {
  const token = decodeCursor(cursor);
  if (token === null) return null;
  const idx = token.indexOf(":");
  if (idx < 0) return null;
  const tsMs = Number(token.slice(0, idx));
  const id = token.slice(idx + 1);
  if (!Number.isFinite(tsMs) || !id) return null;
  return { tsMs, id };
}

/** Build a page from `limit + 1` fetched rows: trims the probe row and derives nextCursor. */
export function pageFrom<T>(rows: T[], limit: number, tokenOf: (row: T) => string): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(tokenOf(items[items.length - 1]!)) };
}
