export function resolveIntegrationConnectionReturnPath(returnTo: string | null): string | null {
  if (
    returnTo === null ||
    returnTo.length === 0 ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//")
  ) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(returnTo, "http://localhost");
  } catch {
    return null;
  }

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

export function appendIntegrationConnectionReturnParams(input: {
  returnPath: string;
  params: Readonly<Record<string, string>>;
}): string {
  const parsedUrl = new URL(input.returnPath, "http://localhost");

  for (const [key, value] of Object.entries(input.params)) {
    parsedUrl.searchParams.set(key, value);
  }

  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}
