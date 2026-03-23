function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function buildDashboardUrl(dashboardBaseUrl: string, path: string): string {
  const url = new URL(dashboardBaseUrl);
  url.pathname = `${trimTrailingSlash(url.pathname)}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
