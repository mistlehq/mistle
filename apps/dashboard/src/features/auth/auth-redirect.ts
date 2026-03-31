function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveSafePostLoginPath(input: {
  pathname: unknown;
  search?: unknown;
  hash?: unknown;
}): string {
  const pathname = input.pathname;
  if (typeof pathname !== "string" || pathname.length === 0) {
    return "/";
  }

  const lowerPathname = pathname.toLowerCase();
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    lowerPathname === "/auth/login" ||
    lowerPathname === "/auth/login/" ||
    lowerPathname === "/auth/login/callback" ||
    lowerPathname === "/auth/login/callback/"
  ) {
    return "/";
  }

  const search = typeof input.search === "string" ? input.search : "";
  const hash = typeof input.hash === "string" ? input.hash : "";

  return `${pathname}${search}${hash}`;
}

export function resolvePostLoginPath(state: unknown): string {
  if (!isObjectRecord(state)) {
    return "/";
  }

  const from = state.from;
  if (!isObjectRecord(from)) {
    return "/";
  }

  return resolveSafePostLoginPath({
    pathname: from.pathname,
    search: from.search,
    hash: from.hash,
  });
}

export function resolveSerializedPostLoginPath(redirectTo: string | null | undefined): string {
  if (redirectTo === null || redirectTo === undefined) {
    return "/";
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(redirectTo, "http://localhost");
  } catch {
    return "/";
  }

  return resolveSafePostLoginPath({
    pathname: parsedUrl.pathname,
    search: parsedUrl.search,
    hash: parsedUrl.hash,
  });
}

export function resolveRequestedPostLoginPath(input: {
  state: unknown;
  redirectTo: string | null | undefined;
}): string {
  if (typeof input.redirectTo === "string" && input.redirectTo.length > 0) {
    return resolveSerializedPostLoginPath(input.redirectTo);
  }

  return resolvePostLoginPath(input.state);
}
