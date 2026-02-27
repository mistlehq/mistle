import type { HttpApiErrorInput } from "./http-api-error.js";

import { getDashboardConfig } from "../../config.js";
import { HttpApiError, readApiErrorMessage, readHttpErrorCode } from "./http-api-error.js";

type ControlPlaneQueryValue = string | number | boolean;

type RequestControlPlaneInput = {
  operation: string;
  pathname: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, ControlPlaneQueryValue | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  fallbackMessage: string;
  basePath?: string;
  errorFactory?: (input: HttpApiErrorInput) => Error;
};

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

  const response = await fetch(url, {
    method: input.method,
    credentials: "include",
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    headers:
      input.body === undefined
        ? {
            accept: "application/json",
          }
        : {
            accept: "application/json",
            "content-type": "application/json",
          },
    body: input.body === undefined ? null : JSON.stringify(input.body),
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
