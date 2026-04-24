function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function buildDashboardUrl(dashboardBaseUrl: string, path: string): string {
  const url = new URL(dashboardBaseUrl);
  const pathUrl = new URL(path, "https://dashboard-path.local");
  url.pathname = `${trimTrailingSlash(url.pathname)}${pathUrl.pathname}`;
  url.search = pathUrl.search;
  url.hash = "";
  return url.toString();
}
