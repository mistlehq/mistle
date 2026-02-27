import type {
  CreateSandboxProfileInput,
  SandboxProfile,
  SandboxProfilesListResult,
  UpdateSandboxProfileInput,
} from "./sandbox-profiles-types.js";

import { getDashboardConfig } from "../../config.js";
import { SandboxProfilesApiError } from "./sandbox-profiles-api-errors.js";
import {
  parseSandboxProfile,
  parseSandboxProfilesListResult,
  readSandboxProfilesErrorMessage,
} from "./sandbox-profiles-parser.js";

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
}

function readErrorCode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidateCode = Reflect.get(payload, "code");
  if (typeof candidateCode !== "string") {
    return null;
  }

  return candidateCode;
}

function buildSandboxProfilesApiError(input: {
  operation: string;
  response: Response;
  payload: unknown;
  fallbackMessage: string;
}): SandboxProfilesApiError {
  return new SandboxProfilesApiError({
    operation: input.operation,
    status: input.response.status,
    body: input.payload,
    message: readSandboxProfilesErrorMessage(input.payload) ?? input.fallbackMessage,
    code: readErrorCode(input.payload),
  });
}

function createSandboxProfilesUrl(pathname: string, params?: URLSearchParams): string {
  const config = getDashboardConfig();
  const url = new URL(pathname, config.controlPlaneApiOrigin);
  if (params !== undefined) {
    url.search = params.toString();
  }

  return url.toString();
}

export async function listSandboxProfiles(input: {
  limit: number;
  after: string | null;
  before: string | null;
  signal?: AbortSignal;
}): Promise<SandboxProfilesListResult> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  if (input.after !== null) {
    params.set("after", input.after);
  }
  if (input.before !== null) {
    params.set("before", input.before);
  }

  const response = await fetch(createSandboxProfilesUrl("/v1/sandbox/profiles", params), {
    method: "GET",
    credentials: "include",
    signal: input.signal ?? null,
    headers: {
      accept: "application/json",
    },
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw buildSandboxProfilesApiError({
      operation: "listSandboxProfiles",
      response,
      payload,
      fallbackMessage: "Could not load sandbox profiles.",
    });
  }

  const parsed = parseSandboxProfilesListResult(payload);
  if (parsed === null) {
    throw new SandboxProfilesApiError({
      operation: "listSandboxProfiles",
      status: response.status,
      body: payload,
      message: "Sandbox profiles list response was invalid.",
      code: null,
    });
  }

  return parsed;
}

export async function getSandboxProfile(input: {
  profileId: string;
  signal?: AbortSignal;
}): Promise<SandboxProfile> {
  const response = await fetch(
    createSandboxProfilesUrl(`/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}`),
    {
      method: "GET",
      credentials: "include",
      signal: input.signal ?? null,
      headers: {
        accept: "application/json",
      },
    },
  );

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw buildSandboxProfilesApiError({
      operation: "getSandboxProfile",
      response,
      payload,
      fallbackMessage: "Could not load sandbox profile.",
    });
  }

  const parsed = parseSandboxProfile(payload);
  if (parsed === null) {
    throw new SandboxProfilesApiError({
      operation: "getSandboxProfile",
      status: response.status,
      body: payload,
      message: "Sandbox profile response was invalid.",
      code: null,
    });
  }

  return parsed;
}

export async function createSandboxProfile(input: {
  payload: CreateSandboxProfileInput;
}): Promise<SandboxProfile> {
  const response = await fetch(createSandboxProfilesUrl("/v1/sandbox/profiles"), {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input.payload),
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw buildSandboxProfilesApiError({
      operation: "createSandboxProfile",
      response,
      payload,
      fallbackMessage: "Could not create sandbox profile.",
    });
  }

  const parsed = parseSandboxProfile(payload);
  if (parsed === null) {
    throw new SandboxProfilesApiError({
      operation: "createSandboxProfile",
      status: response.status,
      body: payload,
      message: "Create sandbox profile response was invalid.",
      code: null,
    });
  }

  return parsed;
}

export async function updateSandboxProfile(input: {
  payload: UpdateSandboxProfileInput;
}): Promise<SandboxProfile> {
  const response = await fetch(
    createSandboxProfilesUrl(`/v1/sandbox/profiles/${encodeURIComponent(input.payload.profileId)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: input.payload.displayName,
        status: input.payload.status,
      }),
    },
  );

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw buildSandboxProfilesApiError({
      operation: "updateSandboxProfile",
      response,
      payload,
      fallbackMessage: "Could not update sandbox profile.",
    });
  }

  const parsed = parseSandboxProfile(payload);
  if (parsed === null) {
    throw new SandboxProfilesApiError({
      operation: "updateSandboxProfile",
      status: response.status,
      body: payload,
      message: "Update sandbox profile response was invalid.",
      code: null,
    });
  }

  return parsed;
}
