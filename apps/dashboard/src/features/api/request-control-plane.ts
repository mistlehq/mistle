import { getDashboardConfig } from "../../config.js";
import type { HttpApiErrorInput } from "./http-api-error.js";
import { HttpApiError, readApiErrorMessage, readHttpErrorCode } from "./http-api-error.js";

type ControlPlaneQueryValue = string | number | boolean;

type RequestControlPlaneInput = {
  operation: string;
  pathname: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, ControlPlaneQueryValue | null | undefined>;
  body?: FormData | object | undefined;
  signal?: AbortSignal;
  fallbackMessage: string;
  basePath?: string;
  errorFactory?: (input: HttpApiErrorInput) => Error;
};

let requestHeadersForTest: HeadersInit | undefined;

export function setControlPlaneRequestHeadersForTest(headers: HeadersInit | undefined): void {
  requestHeadersForTest = headers;
}

function createRequestHeaders(input: { hasBody: boolean; isMultipartBody: boolean }): Headers {
  const headers = new Headers();
  headers.set("accept", "application/json");

  if (input.hasBody && !input.isMultipartBody) {
    headers.set("content-type", "application/json");
  }

  if (requestHeadersForTest !== undefined) {
    new Headers(requestHeadersForTest).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
}

function createControlPlaneUrl(input: {
  pathname: string;
  basePath?: string;
  query?: Record<string, ControlPlaneQueryValue | null | undefined>;
}): URL {
  const config = getDashboardConfig();
  const basePath = input.basePath ?? "";
  const joinedPath = `${basePath}${input.pathname}`;
  const url = new URL(joinedPath, config.controlPlaneApiOrigin);

  if (input.query !== undefined) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value === null || value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

export async function requestControlPlane(input: RequestControlPlaneInput): Promise<Response> {
  const url = createControlPlaneUrl({
    pathname: input.pathname,
    ...(input.basePath === undefined ? {} : { basePath: input.basePath }),
    ...(input.query === undefined ? {} : { query: input.query }),
  });

  const isMultipartBody = input.body instanceof FormData;
  let requestBody: BodyInit | null = null;
  if (input.body instanceof FormData) {
    requestBody = input.body;
  } else if (input.body !== undefined) {
    requestBody = JSON.stringify(input.body);
  }

  const response = await fetch(url, {
    method: input.method,
    credentials: "include",
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    headers: createRequestHeaders({
      hasBody: input.body !== undefined,
      isMultipartBody,
    }),
    body: requestBody,
  });

  if (response.ok) {
    return response;
  }

  const payload = await readResponsePayload(response);
  const errorInput: HttpApiErrorInput = {
    operation: input.operation,
    status: response.status,
    body: payload,
    message: readApiErrorMessage(payload) ?? input.fallbackMessage,
    code: readHttpErrorCode(payload),
  };

  if (input.errorFactory !== undefined) {
    throw input.errorFactory(errorInput);
  }

  throw new HttpApiError(errorInput);
}
