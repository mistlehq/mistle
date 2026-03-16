import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

export type HeaderBag = Map<string, string[]>;

function appendHeaderValue(headerBag: HeaderBag, headerName: string, headerValue: string): void {
  const normalizedHeaderName = headerName.toLowerCase();
  const existingValues = headerBag.get(normalizedHeaderName);
  if (existingValues === undefined) {
    headerBag.set(normalizedHeaderName, [headerValue]);
    return;
  }

  existingValues.push(headerValue);
}

function splitConnectionTokens(value: string): ReadonlyArray<string> {
  return value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

export function headerBagFromIncomingHeaders(headers: IncomingHttpHeaders): HeaderBag {
  const headerBag: HeaderBag = new Map();

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerValue === undefined) {
      continue;
    }

    if (Array.isArray(headerValue)) {
      for (const value of headerValue) {
        appendHeaderValue(headerBag, headerName, value);
      }
      continue;
    }

    appendHeaderValue(headerBag, headerName, headerValue);
  }

  return headerBag;
}

export function headerBagToOutgoingHeaders(headerBag: HeaderBag): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};

  for (const [headerName, values] of headerBag.entries()) {
    headers[headerName] = values.length === 1 ? values[0] : values;
  }

  return headers;
}

export function headerBagToFetchHeaders(headerBag: HeaderBag): Headers {
  const headers = new Headers();

  for (const [headerName, values] of headerBag.entries()) {
    for (const value of values) {
      headers.append(headerName, value);
    }
  }

  return headers;
}

export function fetchHeadersFromOutgoingHeaders(headers: OutgoingHttpHeaders): Headers {
  const fetchHeaders = new Headers();

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerValue === undefined) {
      continue;
    }

    if (Array.isArray(headerValue)) {
      for (const value of headerValue) {
        fetchHeaders.append(headerName, String(value));
      }
      continue;
    }

    fetchHeaders.append(headerName, String(headerValue));
  }

  return fetchHeaders;
}

export function headerBagFromHeaders(headers: Headers): HeaderBag {
  const headerBag: HeaderBag = new Map();

  for (const [headerName, headerValue] of headers.entries()) {
    appendHeaderValue(headerBag, headerName, headerValue);
  }

  return headerBag;
}

function hopByHopHeaderNames(source: HeaderBag, includeHost: boolean): Set<string> {
  const excludedHeaderNames = new Set<string>([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);

  if (includeHost) {
    excludedHeaderNames.add("host");
  }

  for (const connectionValue of source.get("connection") ?? []) {
    for (const token of splitConnectionTokens(connectionValue)) {
      excludedHeaderNames.add(token);
    }
  }

  return excludedHeaderNames;
}

export function copyHeadersWithoutHopByHop(source: HeaderBag, includeHost: boolean): HeaderBag {
  const excludedHeaderNames = hopByHopHeaderNames(source, includeHost);
  const filteredHeaders: HeaderBag = new Map();

  for (const [headerName, values] of source.entries()) {
    if (excludedHeaderNames.has(headerName)) {
      continue;
    }

    filteredHeaders.set(headerName, [...values]);
  }

  return filteredHeaders;
}

export function isUpgradeHeaders(source: HeaderBag): boolean {
  const upgradeValues = source.get("upgrade") ?? [];
  if (upgradeValues.every((value) => value.trim().length === 0)) {
    return false;
  }

  for (const connectionValue of source.get("connection") ?? []) {
    if (splitConnectionTokens(connectionValue).includes("upgrade")) {
      return true;
    }
  }

  return false;
}

export function restoreUpgradeHeaders(target: HeaderBag, source: HeaderBag): void {
  if (!isUpgradeHeaders(source)) {
    return;
  }

  target.delete("connection");
  target.delete("upgrade");

  for (const value of source.get("connection") ?? []) {
    appendHeaderValue(target, "connection", value);
  }

  for (const value of source.get("upgrade") ?? []) {
    appendHeaderValue(target, "upgrade", value);
  }
}
