import { z } from "zod";

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

const ResolvedCredentialSchema = z.object({
  value: z.string().min(1),
  expiresAt: z.string().optional(),
});

const ResolverErrorSchema = z
  .object({
    message: z.string().optional(),
  })
  .catchall(z.unknown());

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

    const responseBody: unknown = await response.json();
    const parsedResponse = ResolvedCredentialSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new Error("Control-plane credential resolver response payload is invalid.");
    }

    const { value, expiresAt } = parsedResponse.data;
    return {
      value,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
  }
}

function extractErrorMessage(input: unknown): string {
  const parsedError = ResolverErrorSchema.safeParse(input);
  if (!parsedError.success) {
    return "Unknown control-plane resolver error.";
  }

  const message = parsedError.data.message;
  if (typeof message !== "string" || message.length === 0) {
    return "Unknown control-plane resolver error.";
  }

  return message;
}
