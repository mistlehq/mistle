import { z } from "zod";

import type {
  CredentialCacheInvalidationResult,
  CredentialCacheInvalidator,
} from "./credential-cache-invalidator.js";

const DefaultRequestTimeoutMs = 3_000;
const DataPlaneInternalAuthHeader = "x-mistle-service-token";

const CredentialCacheInvalidationResponseSchema = z
  .object({
    status: z.literal("ok"),
    deletedEntryCount: z.number().int().min(0),
  })
  .strict();

export class GatewayHttpCredentialCacheInvalidator implements CredentialCacheInvalidator {
  public constructor(
    private readonly input: {
      baseUrl: string;
      serviceToken: string;
      testEnvironmentId?: string;
      testEnvironmentIdHeader?: string;
      requestTimeoutMs?: number;
    },
  ) {}

  public async invalidateIntegrationConnection(input: {
    connectionId: string;
  }): Promise<CredentialCacheInvalidationResult> {
    const url = new URL("/internal/egress/credential-cache/invalidate", this.input.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.createHeaders(),
      },
      body: JSON.stringify({
        connectionId: input.connectionId,
      }),
      signal: AbortSignal.timeout(this.input.requestTimeoutMs ?? DefaultRequestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Gateway credential cache invalidation failed with status ${String(response.status)} for connection '${input.connectionId}'.`,
      );
    }

    const json: unknown = await response.json();
    return CredentialCacheInvalidationResponseSchema.parse(json);
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [DataPlaneInternalAuthHeader]: this.input.serviceToken,
    };

    if (
      this.input.testEnvironmentId !== undefined &&
      this.input.testEnvironmentIdHeader !== undefined
    ) {
      headers[this.input.testEnvironmentIdHeader] = this.input.testEnvironmentId;
    }

    return headers;
  }
}
