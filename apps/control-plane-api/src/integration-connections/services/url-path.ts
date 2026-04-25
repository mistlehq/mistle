export function buildUrlWithPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
