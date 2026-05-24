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

function resolveSafeExternalPostLoginUrl(input: {
  redirectTo: string;
  allowedExternalOrigins: readonly string[];
}): string | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.redirectTo);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return null;
  }

  if (!input.allowedExternalOrigins.includes(parsedUrl.origin)) {
    return null;
  }

  return parsedUrl.toString();
}

export function resolveAllowedControlPlaneRedirectOrigins(
  configuredOrigin: string,
): readonly string[] {
  const parsedOrigin = new URL(configuredOrigin);
  const origins = new Set<string>([parsedOrigin.origin]);
  if (parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1") {
    origins.add(
      `${parsedOrigin.protocol}//localhost${parsedOrigin.port === "" ? "" : `:${parsedOrigin.port}`}`,
    );
    origins.add(
      `${parsedOrigin.protocol}//127.0.0.1${parsedOrigin.port === "" ? "" : `:${parsedOrigin.port}`}`,
    );
  }

  return [...origins];
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

export function resolveSerializedPostLoginPath(
  redirectTo: string | null | undefined,
  options: { allowedExternalOrigins?: readonly string[] } = {},
): string {
  if (redirectTo === null || redirectTo === undefined) {
    return "/";
  }

  const externalUrl = resolveSafeExternalPostLoginUrl({
    redirectTo,
    allowedExternalOrigins: options.allowedExternalOrigins ?? [],
  });
  if (externalUrl !== null) {
    return externalUrl;
  }

  try {
    new URL(redirectTo);
    return "/";
  } catch {
    // Continue with relative application path parsing below.
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
  allowedExternalOrigins?: readonly string[];
}): string {
  if (typeof input.redirectTo === "string" && input.redirectTo.length > 0) {
    return resolveSerializedPostLoginPath(
      input.redirectTo,
      input.allowedExternalOrigins === undefined
        ? {}
        : { allowedExternalOrigins: input.allowedExternalOrigins },
    );
  }

  return resolvePostLoginPath(input.state);
}
