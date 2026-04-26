function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function buildUrlWithPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  const pathUrl = new URL(path, "https://path.mistle.local");

  url.pathname = `${trimTrailingSlash(url.pathname)}${pathUrl.pathname}`;
  url.search = pathUrl.search;
  url.hash = "";

  return url.toString();
}
