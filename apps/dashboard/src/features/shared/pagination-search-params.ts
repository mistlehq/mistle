export function parsePaginationCursor(rawValue: string | null): string | null {
  if (rawValue === null) {
    return null;
  }

  const normalized = rawValue.trim();
  return normalized.length === 0 ? null : normalized;
}

export function readKeysetPaginationCursors(searchParams: URLSearchParams): {
  after: string | null;
  before: string | null;
} {
  const after = parsePaginationCursor(searchParams.get("after"));

  return {
    after,
    before: after === null ? parsePaginationCursor(searchParams.get("before")) : null,
  };
}
