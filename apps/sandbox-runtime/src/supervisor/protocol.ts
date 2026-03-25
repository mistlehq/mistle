import { type StartupInput, parseStartupInputPayload } from "../runtime/startup-input.js";

export const DefaultSupervisorMessageMaxBytes = 1024 * 1024;

export type StartupApplyRequest = {
  token: string;
  startupInput: StartupInput;
};

export type StartupApplyResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

function normalizeRequiredString(value: string, fieldLabel: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${fieldLabel} is required`);
  }

  return trimmedValue;
}

export function parseStartupApplyRequestPayload(payload: unknown): StartupApplyRequest {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("startup apply request must be valid json: expected object");
  }

  const allowedFields = new Set(["token", "startupInput"]);
  for (const fieldName of Object.keys(payload)) {
    if (!allowedFields.has(fieldName)) {
      throw new Error(`startup apply request must be valid json: unexpected field ${fieldName}`);
    }
  }

  const rawToken = Object.getOwnPropertyDescriptor(payload, "token")?.value;
  if (typeof rawToken !== "string") {
    throw new Error("startup apply request token is required");
  }

  const rawStartupInput = Object.getOwnPropertyDescriptor(payload, "startupInput")?.value;
  try {
    return {
      token: normalizeRequiredString(rawToken, "startup apply request token"),
      startupInput: parseStartupInputPayload(rawStartupInput),
    };
  } catch (error) {
    throw new Error(
      `startup apply request startupInput is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseStartupApplyResponsePayload(payload: unknown): StartupApplyResponse {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("startup apply response must be valid json: expected object");
  }

  const rawOk = Object.getOwnPropertyDescriptor(payload, "ok")?.value;
  if (typeof rawOk !== "boolean") {
    throw new Error("startup apply response ok is required");
  }

  if (rawOk) {
    return {
      ok: true,
    };
  }

  const rawError = Object.getOwnPropertyDescriptor(payload, "error")?.value;
  if (typeof rawError !== "string") {
    throw new Error("startup apply response error is required");
  }

  return {
    ok: false,
    error: normalizeRequiredString(rawError, "startup apply response error"),
  };
}
