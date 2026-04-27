export function buildSlackApiUrl(input: { apiBaseUrl: string; path: string }): URL {
  const apiUrl = new URL(input.apiBaseUrl);
  const normalizedBasePath = apiUrl.pathname === "/" ? "" : apiUrl.pathname.replace(/\/$/, "");
  apiUrl.pathname = `${normalizedBasePath}/${input.path.replace(/^\//, "")}`;
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl;
}
