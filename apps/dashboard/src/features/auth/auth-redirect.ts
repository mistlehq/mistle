function readLocationProperty(
  value: object,
  key: "from" | "pathname" | "search" | "hash",
): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function resolvePostLoginPath(state: unknown): string {
  if (typeof state !== "object" || state === null) {
    return "/";
  }

  const from = readLocationProperty(state, "from");
  if (typeof from !== "object" || from === null) {
    return "/";
  }

  const pathname = readLocationProperty(from, "pathname");
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

  const searchValue = readLocationProperty(from, "search");
  const hashValue = readLocationProperty(from, "hash");
  const search = typeof searchValue === "string" ? searchValue : "";
  const hash = typeof hashValue === "string" ? hashValue : "";

  return `${pathname}${search}${hash}`;
}
