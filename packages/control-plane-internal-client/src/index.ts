import type { Client } from "openapi-fetch";
import createClient from "openapi-fetch";
import { z } from "zod";

import type { paths } from "./generated/schema.js";

const ControlPlaneInternalAuthHeader = "x-mistle-service-token";
const DefaultRequestTimeoutMs = 3000;

const InternalErrorSchema = z
  .object({
    message: z.string().optional(),
  })
  .catchall(z.unknown());

export type CreateControlPlaneInternalClientInput = {
  baseUrl: string;
  internalAuthServiceToken: string;
  requestTimeoutMs?: number;
};

export type ResolveIntegrationCredentialInput =
  paths["/internal/integration-credentials/resolve"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveIntegrationCredentialOutput =
  paths["/internal/integration-credentials/resolve"]["post"]["responses"]["200"]["content"]["application/json"];

export type ResolveIntegrationTargetSecretsInput =
  paths["/internal/integration-credentials/resolve-target-secrets"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveIntegrationTargetSecretsOutput =
  paths["/internal/integration-credentials/resolve-target-secrets"]["post"]["responses"]["200"]["content"]["application/json"];

export type StartSandboxProfileInstanceInput =
  paths["/internal/sandbox-runtime/start-profile-instance"]["post"]["requestBody"]["content"]["application/json"];
export type StartSandboxProfileInstanceOutput =
  paths["/internal/sandbox-runtime/start-profile-instance"]["post"]["responses"]["200"]["content"]["application/json"];
export type GetSandboxInstanceInput =
  paths["/internal/sandbox-runtime/get-sandbox-instance"]["post"]["requestBody"]["content"]["application/json"];
export type GetSandboxInstanceOutput =
  paths["/internal/sandbox-runtime/get-sandbox-instance"]["post"]["responses"]["200"]["content"]["application/json"];

export type MintSandboxConnectionTokenInput =
  paths["/internal/sandbox-runtime/mint-connection-token"]["post"]["requestBody"]["content"]["application/json"];
export type MintSandboxConnectionTokenOutput =
  paths["/internal/sandbox-runtime/mint-connection-token"]["post"]["responses"]["200"]["content"]["application/json"];
export type RequestIntegrationConnectionResourceRefreshInput =
  paths["/internal/integration-connections/refresh-resource"]["post"]["requestBody"]["content"]["application/json"];
export type RequestIntegrationConnectionResourceRefreshOutput =
  paths["/internal/integration-connections/refresh-resource"]["post"]["responses"]["202"]["content"]["application/json"];

function extractErrorMessage(input: unknown): string {
  const parsedError = InternalErrorSchema.safeParse(input);
  if (!parsedError.success) {
    return "Unknown control-plane internal API error.";
  }

  const message = parsedError.data.message;
  if (typeof message !== "string" || message.length === 0) {
    return "Unknown control-plane internal API error.";
  }

  return message;
}

export class ControlPlaneInternalClient {
  readonly #client: Client<paths>;
  readonly #requestTimeoutMs: number;

  constructor(input: CreateControlPlaneInternalClientInput) {
    this.#client = createClient<paths>({
      baseUrl: input.baseUrl,
      headers: {
        [ControlPlaneInternalAuthHeader]: input.internalAuthServiceToken,
      },
    });
    this.#requestTimeoutMs = input.requestTimeoutMs ?? DefaultRequestTimeoutMs;
  }

  async resolveIntegrationCredential(
    input: ResolveIntegrationCredentialInput,
  ): Promise<ResolveIntegrationCredentialOutput> {
    const result = await this.#client.POST("/internal/integration-credentials/resolve", {
      body: input,
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal credential resolution failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async resolveIntegrationTargetSecrets(
    input: ResolveIntegrationTargetSecretsInput,
  ): Promise<ResolveIntegrationTargetSecretsOutput> {
    const result = await this.#client.POST(
      "/internal/integration-credentials/resolve-target-secrets",
      {
        body: input,
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      },
    );

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal target secret resolution failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async startSandboxProfileInstance(
    input: StartSandboxProfileInstanceInput,
  ): Promise<StartSandboxProfileInstanceOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/start-profile-instance", {
      body: input,
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal sandbox start failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async mintSandboxConnectionToken(
    input: MintSandboxConnectionTokenInput,
  ): Promise<MintSandboxConnectionTokenOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/mint-connection-token", {
      body: input,
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal sandbox connection mint failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async getSandboxInstance(input: GetSandboxInstanceInput): Promise<GetSandboxInstanceOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/get-sandbox-instance", {
      body: input,
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal sandbox read failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async requestIntegrationConnectionResourceRefresh(
    input: RequestIntegrationConnectionResourceRefreshInput,
  ): Promise<RequestIntegrationConnectionResourceRefreshOutput> {
    const result = await this.#client.POST("/internal/integration-connections/refresh-resource", {
      body: input,
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 202 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal resource refresh failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }
}
