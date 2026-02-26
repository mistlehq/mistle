function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function resolvePostLoginPath(state: unknown): string {
  if (!isObjectRecord(state)) {
    return "/";
  }

  const from = state.from;
  if (!isObjectRecord(from)) {
    return "/";
  }

  const pathname = from.pathname;
  if (typeof pathname !== "string" || pathname.length === 0) {
    return "/";
  }

  const lowerPathname = pathname.toLowerCase();
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    lowerPathname === "/auth/login" ||
    lowerPathname === "/auth/login/"
  ) {
    return "/";
  }

  const search = typeof from.search === "string" ? from.search : "";
  const hash = typeof from.hash === "string" ? from.hash : "";

  return `${pathname}${search}${hash}`;
}
