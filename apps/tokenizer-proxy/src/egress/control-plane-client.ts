import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "./constants.js";

export type ResolveCredentialInput = {
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

export type ResolvedCredential = {
  value: string;
  expiresAt?: string;
};

type ControlPlaneCredentialResolverClientInput = {
  baseUrl: string;
  internalAuthServiceToken: string;
  requestTimeoutMs: number;
};

export class ControlPlaneCredentialResolverClient {
  readonly #resolveEndpoint: string;
  readonly #internalAuthServiceToken: string;
  readonly #requestTimeoutMs: number;

  constructor(input: ControlPlaneCredentialResolverClientInput) {
    this.#resolveEndpoint = new URL(
      "/internal/integration-credentials/resolve",
      input.baseUrl,
    ).toString();
    this.#internalAuthServiceToken = input.internalAuthServiceToken;
    this.#requestTimeoutMs = input.requestTimeoutMs;
  }

  async resolveCredential(input: ResolveCredentialInput): Promise<ResolvedCredential> {
    const response = await fetch(this.#resolveEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: this.#internalAuthServiceToken,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (!response.ok) {
      const responseBody = await response
        .json()
        .catch((): unknown => ({ message: "Unknown control-plane resolver error." }));

      const message = extractErrorMessage(responseBody);
      throw new Error(
        `Control-plane credential resolver request failed with status ${String(response.status)}: ${message}`,
      );
    }

    const responseBody = await response.json();

    if (typeof responseBody !== "object" || responseBody === null) {
      throw new Error("Control-plane credential resolver response must be an object.");
    }

    const resolvedValue = Reflect.get(responseBody, "value");
    if (typeof resolvedValue !== "string" || resolvedValue.length === 0) {
      throw new Error("Control-plane credential resolver response is missing `value`.");
    }

    const expiresAtValue = Reflect.get(responseBody, "expiresAt");
    if (expiresAtValue !== undefined && typeof expiresAtValue !== "string") {
      throw new Error(
        "Control-plane credential resolver response `expiresAt` must be a string when provided.",
      );
    }

    return {
      value: resolvedValue,
      ...(expiresAtValue === undefined ? {} : { expiresAt: expiresAtValue }),
    };
  }
}

function extractErrorMessage(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    return "Unknown control-plane resolver error.";
  }

  const message = Reflect.get(input, "message");
  if (typeof message !== "string" || message.length === 0) {
    return "Unknown control-plane resolver error.";
  }

  return message;
}
