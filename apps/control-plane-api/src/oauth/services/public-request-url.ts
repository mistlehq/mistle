import { buildUrlWithPath } from "@mistle/http";

export function buildPublicRequestUrl(input: {
  publicBaseUrl: string;
  requestUrl: string;
}): string {
  const requestUrl = new URL(input.requestUrl);
  return buildUrlWithPath(input.publicBaseUrl, `${requestUrl.pathname}${requestUrl.search}`);
}
