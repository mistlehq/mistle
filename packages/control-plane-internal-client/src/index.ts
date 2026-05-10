import type { Client } from "openapi-fetch";
import createClient from "openapi-fetch";
import { z } from "zod";

import type { paths } from "./generated/schema.js";

const ControlPlaneInternalAuthHeader = "x-mistle-service-token";
const DefaultRequestTimeoutMs = 3000;

const InternalErrorSchema = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .catchall(z.unknown());

export type CreateControlPlaneInternalClientInput = {
  baseUrl: string;
  internalAuthServiceToken: string;
  requestTimeoutMs?: number;
  testEnvironmentId?: string;
  testEnvironmentIdHeader?: string;
};

export type ControlPlaneInternalClientRequestOptions = {
  testEnvironmentId?: string;
};

export type ResolveIntegrationCredentialInput =
  paths["/internal/integration-credentials/resolve"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveIntegrationCredentialOutput =
  paths["/internal/integration-credentials/resolve"]["post"]["responses"]["200"]["content"]["application/json"];

export type ResolveIntegrationTargetSecretsInput =
  paths["/internal/integration-credentials/resolve-target-secrets"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveIntegrationTargetSecretsOutput =
  paths["/internal/integration-credentials/resolve-target-secrets"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResolveIdentityLinkPrincipalCredentialInput =
  paths["/internal/identity-linking/resolve-principal-credential"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveIdentityLinkPrincipalCredentialOutput =
  paths["/internal/identity-linking/resolve-principal-credential"]["post"]["responses"]["200"]["content"]["application/json"];
export type SignIdentityLinkCommitPayloadInput =
  paths["/internal/identity-linking/sign-commit-payload"]["post"]["requestBody"]["content"]["application/json"];
export type SignIdentityLinkCommitPayloadOutput =
  paths["/internal/identity-linking/sign-commit-payload"]["post"]["responses"]["200"]["content"]["application/json"];

export type StartSandboxProfileInstanceInput =
  paths["/internal/sandbox-runtime/start-profile-instance"]["post"]["requestBody"]["content"]["application/json"];
export type StartSandboxProfileInstanceOutput =
  paths["/internal/sandbox-runtime/start-profile-instance"]["post"]["responses"]["200"]["content"]["application/json"];
export type CompileSandboxProfileVersionRuntimePlanInput =
  paths["/internal/sandbox-runtime/compile-plan"]["post"]["requestBody"]["content"]["application/json"];
export type CompileSandboxProfileVersionRuntimePlanOutput =
  paths["/internal/sandbox-runtime/compile-plan"]["post"]["responses"]["200"]["content"]["application/json"];
export type GetSandboxInstanceInput =
  paths["/internal/sandbox-runtime/get-sandbox-instance"]["post"]["requestBody"]["content"]["application/json"];
export type GetSandboxInstanceOutput =
  paths["/internal/sandbox-runtime/get-sandbox-instance"]["post"]["responses"]["200"]["content"]["application/json"];

export type MintSandboxConnectionTokenInput =
  paths["/internal/sandbox-runtime/mint-connection-token"]["post"]["requestBody"]["content"]["application/json"];
export type MintSandboxConnectionTokenOutput =
  paths["/internal/sandbox-runtime/mint-connection-token"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResumeSandboxInstanceForConnectionInput =
  paths["/internal/sandbox-runtime/resume-sandbox-instance"]["post"]["requestBody"]["content"]["application/json"];
export type ResumeSandboxInstanceForConnectionOutput =
  paths["/internal/sandbox-runtime/resume-sandbox-instance"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResolveSandboxRuntimeCredentialsInput =
  paths["/internal/sandbox-runtime/resolve-credentials"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveSandboxRuntimeCredentialsOutput =
  paths["/internal/sandbox-runtime/resolve-credentials"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResolveStoragePersistenceModeInput =
  paths["/internal/sandbox-storage/resolve-persistence-mode"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveStoragePersistenceModeOutput =
  paths["/internal/sandbox-storage/resolve-persistence-mode"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResolveStorageConfigurationInput =
  paths["/internal/sandbox-storage/resolve-configuration"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveStorageConfigurationOutput =
  paths["/internal/sandbox-storage/resolve-configuration"]["post"]["responses"]["200"]["content"]["application/json"];
type OrganizationStorageConfigurationOutput = Extract<
  ResolveStorageConfigurationOutput,
  { storageConfigSource: "organization" }
>["organizationStorageConfig"];
export type EncryptStorageCredentialInput =
  paths["/internal/sandbox-storage/encrypt-credential"]["post"]["requestBody"]["content"]["application/json"];
export type EncryptStorageCredentialOutput =
  paths["/internal/sandbox-storage/encrypt-credential"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResolveStorageCredentialInput =
  paths["/internal/sandbox-storage/resolve-credential"]["post"]["requestBody"]["content"]["application/json"];
export type ResolveStorageCredentialOutput =
  paths["/internal/sandbox-storage/resolve-credential"]["post"]["responses"]["200"]["content"]["application/json"];
export type RequestIntegrationConnectionResourceRefreshInput =
  paths["/internal/integration-connections/refresh-resource"]["post"]["requestBody"]["content"]["application/json"];
export type RequestIntegrationConnectionResourceRefreshOutput =
  paths["/internal/integration-connections/refresh-resource"]["post"]["responses"]["202"]["content"]["application/json"];
export type ClaimSandboxProfileVersionSnapshotJobInput = {
  snapshotJobId: string;
  workflowRunId: paths["/internal/snapshot-jobs/{jobId}/claim"]["post"]["requestBody"]["content"]["application/json"]["workflowRunId"];
};
export type ClaimSandboxProfileVersionSnapshotJobOutput =
  paths["/internal/snapshot-jobs/{jobId}/claim"]["post"]["responses"]["200"]["content"]["application/json"];
export type MarkSandboxProfileVersionSnapshotJobSucceededInput = {
  snapshotJobId: string;
  workflowRunId: paths["/internal/snapshot-jobs/{jobId}/succeed"]["post"]["requestBody"]["content"]["application/json"]["workflowRunId"];
  image: paths["/internal/snapshot-jobs/{jobId}/succeed"]["post"]["requestBody"]["content"]["application/json"]["image"];
};
export type MarkSandboxProfileVersionSnapshotJobSucceededOutput =
  paths["/internal/snapshot-jobs/{jobId}/succeed"]["post"]["responses"]["200"]["content"]["application/json"];
export type MarkSandboxProfileVersionSnapshotJobFailedInput = {
  snapshotJobId: string;
  workflowRunId: paths["/internal/snapshot-jobs/{jobId}/fail"]["post"]["requestBody"]["content"]["application/json"]["workflowRunId"];
  errorCode: paths["/internal/snapshot-jobs/{jobId}/fail"]["post"]["requestBody"]["content"]["application/json"]["errorCode"];
  errorMessage: paths["/internal/snapshot-jobs/{jobId}/fail"]["post"]["requestBody"]["content"]["application/json"]["errorMessage"];
};
export type MarkSandboxProfileVersionSnapshotJobFailedOutput =
  paths["/internal/snapshot-jobs/{jobId}/fail"]["post"]["responses"]["200"]["content"]["application/json"];

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

function extractErrorCode(input: unknown): string | undefined {
  const parsedError = InternalErrorSchema.safeParse(input);
  if (!parsedError.success) {
    return undefined;
  }

  const code = parsedError.data.code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

export class ControlPlaneInternalClientRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(input: { status: number; message: string; code: string | undefined }) {
    super(input.message);
    this.name = "ControlPlaneInternalClientRequestError";
    this.status = input.status;
    this.code = input.code;
  }
}

export class ControlPlaneInternalClient {
  readonly #client: Client<paths>;
  readonly #internalAuthServiceToken: string;
  readonly #requestTimeoutMs: number;
  readonly #testEnvironmentId: string | undefined;
  readonly #testEnvironmentIdHeader: string | undefined;

  constructor(input: CreateControlPlaneInternalClientInput) {
    this.#client = createClient<paths>({
      baseUrl: input.baseUrl,
    });
    this.#internalAuthServiceToken = input.internalAuthServiceToken;
    this.#requestTimeoutMs = input.requestTimeoutMs ?? DefaultRequestTimeoutMs;
    this.#testEnvironmentId = input.testEnvironmentId;
    this.#testEnvironmentIdHeader = input.testEnvironmentIdHeader;
  }

  async resolveIntegrationCredential(
    input: ResolveIntegrationCredentialInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResolveIntegrationCredentialOutput> {
    const result = await this.#client.POST("/internal/integration-credentials/resolve", {
      body: input,
      headers: this.#headers(options),
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
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResolveIntegrationTargetSecretsOutput> {
    const result = await this.#client.POST(
      "/internal/integration-credentials/resolve-target-secrets",
      {
        body: input,
        headers: this.#headers(options),
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

  async resolveIdentityLinkPrincipalCredential(
    input: ResolveIdentityLinkPrincipalCredentialInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResolveIdentityLinkPrincipalCredentialOutput> {
    const result = await this.#client.POST(
      "/internal/identity-linking/resolve-principal-credential",
      {
        body: input,
        headers: this.#headers(options),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      },
    );

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal linked-principal credential resolution failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async signIdentityLinkCommitPayload(
    input: SignIdentityLinkCommitPayloadInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<SignIdentityLinkCommitPayloadOutput> {
    const result = await this.#client.POST("/internal/identity-linking/sign-commit-payload", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new ControlPlaneInternalClientRequestError({
      status: result.response.status,
      code: extractErrorCode(result.error),
      message: `Control-plane internal linked-principal commit signing failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    });
  }

  async startSandboxProfileInstance(
    input: StartSandboxProfileInstanceInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<StartSandboxProfileInstanceOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/start-profile-instance", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal sandbox start failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async compileSandboxProfileVersionRuntimePlan(
    input: CompileSandboxProfileVersionRuntimePlanInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<CompileSandboxProfileVersionRuntimePlanOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/compile-plan", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new ControlPlaneInternalClientRequestError({
      status: result.response.status,
      code: extractErrorCode(result.error),
      message: `Control-plane internal runtime plan compile failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    });
  }

  async mintSandboxConnectionToken(
    input: MintSandboxConnectionTokenInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<MintSandboxConnectionTokenOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/mint-connection-token", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal sandbox connection mint failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async resumeSandboxInstanceForConnection(
    input: ResumeSandboxInstanceForConnectionInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResumeSandboxInstanceForConnectionOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/resume-sandbox-instance", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal sandbox resume failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async getSandboxInstance(
    input: GetSandboxInstanceInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<GetSandboxInstanceOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/get-sandbox-instance", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal sandbox read failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async resolveStoragePersistenceMode(
    input: ResolveStoragePersistenceModeInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResolveStoragePersistenceModeOutput> {
    const result = await this.#client.POST("/internal/sandbox-storage/resolve-persistence-mode", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal storage persistence-mode resolve failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async resolveStorageConfiguration(
    input: ResolveStorageConfigurationInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResolveStorageConfigurationOutput> {
    const result = await this.#client.POST("/internal/sandbox-storage/resolve-configuration", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      if (result.data.storageConfigSource === "managed") {
        if (!result.data.persistentSandboxesEnabled) {
          return {
            persistentSandboxesEnabled: false,
            storageConfigSource: "managed",
            storageBackend: null,
            organizationStorageConfig: null,
          };
        }

        return {
          persistentSandboxesEnabled: true,
          storageConfigSource: "managed",
          storageBackend: result.data.storageBackend,
          organizationStorageConfig: null,
        };
      }

      const mounts: OrganizationStorageConfigurationOutput["mounts"] =
        result.data.organizationStorageConfig.mounts === undefined
          ? undefined
          : result.data.organizationStorageConfig.mounts.length === 0
            ? []
            : (() => {
                const firstMount = result.data.organizationStorageConfig.mounts[0];
                if (firstMount === undefined) {
                  throw new Error("Expected organization storage mount entry.");
                }

                return [
                  {
                    accessKeyId: firstMount.accessKeyId,
                    bucket: firstMount.bucket,
                    endpoint: firstMount.endpoint,
                    secretAccessKey: firstMount.secretAccessKey,
                    type: firstMount.type,
                  },
                ];
              })();

      return {
        persistentSandboxesEnabled: true,
        storageConfigSource: "organization",
        storageBackend: "archil",
        organizationStorageConfig: {
          backend: "archil",
          apiKey: result.data.organizationStorageConfig.apiKey,
          region: result.data.organizationStorageConfig.region,
          ...(result.data.organizationStorageConfig.namePrefix === undefined
            ? {}
            : { namePrefix: result.data.organizationStorageConfig.namePrefix }),
          ...(mounts === undefined ? {} : { mounts }),
        },
      };
    }

    throw new Error(
      `Control-plane internal storage configuration resolve failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async encryptStorageCredential(
    input: EncryptStorageCredentialInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<EncryptStorageCredentialOutput> {
    const result = await this.#client.POST("/internal/sandbox-storage/encrypt-credential", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal storage credential encrypt failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async resolveStorageCredential(
    input: ResolveStorageCredentialInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResolveStorageCredentialOutput> {
    const result = await this.#client.POST("/internal/sandbox-storage/resolve-credential", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal storage credential resolve failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async requestIntegrationConnectionResourceRefresh(
    input: RequestIntegrationConnectionResourceRefreshInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<RequestIntegrationConnectionResourceRefreshOutput> {
    const result = await this.#client.POST("/internal/integration-connections/refresh-resource", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 202 && result.data !== undefined) {
      return result.data;
    }

    throw new Error(
      `Control-plane internal resource refresh failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    );
  }

  async claimSandboxProfileVersionSnapshotJob(
    input: ClaimSandboxProfileVersionSnapshotJobInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ClaimSandboxProfileVersionSnapshotJobOutput> {
    const result = await this.#client.POST("/internal/snapshot-jobs/{jobId}/claim", {
      params: {
        path: {
          jobId: input.snapshotJobId,
        },
      },
      body: {
        workflowRunId: input.workflowRunId,
      },
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new ControlPlaneInternalClientRequestError({
      status: result.response.status,
      code: extractErrorCode(result.error),
      message: `Control-plane internal snapshot job claim failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    });
  }

  async resolveSandboxRuntimeCredentials(
    input: ResolveSandboxRuntimeCredentialsInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<ResolveSandboxRuntimeCredentialsOutput> {
    const result = await this.#client.POST("/internal/sandbox-runtime/resolve-credentials", {
      body: input,
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new ControlPlaneInternalClientRequestError({
      status: result.response.status,
      code: extractErrorCode(result.error),
      message: `Control-plane internal sandbox runtime credential resolution failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    });
  }

  async markSandboxProfileVersionSnapshotJobSucceeded(
    input: MarkSandboxProfileVersionSnapshotJobSucceededInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<MarkSandboxProfileVersionSnapshotJobSucceededOutput> {
    const result = await this.#client.POST("/internal/snapshot-jobs/{jobId}/succeed", {
      params: {
        path: {
          jobId: input.snapshotJobId,
        },
      },
      body: {
        workflowRunId: input.workflowRunId,
        image: input.image,
      },
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new ControlPlaneInternalClientRequestError({
      status: result.response.status,
      code: extractErrorCode(result.error),
      message: `Control-plane internal snapshot job success update failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    });
  }

  async markSandboxProfileVersionSnapshotJobFailed(
    input: MarkSandboxProfileVersionSnapshotJobFailedInput,
    options: ControlPlaneInternalClientRequestOptions = {},
  ): Promise<MarkSandboxProfileVersionSnapshotJobFailedOutput> {
    const result = await this.#client.POST("/internal/snapshot-jobs/{jobId}/fail", {
      params: {
        path: {
          jobId: input.snapshotJobId,
        },
      },
      body: {
        workflowRunId: input.workflowRunId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
      headers: this.#headers(options),
      signal: AbortSignal.timeout(this.#requestTimeoutMs),
    });

    if (result.response.status === 200 && result.data !== undefined) {
      return result.data;
    }

    throw new ControlPlaneInternalClientRequestError({
      status: result.response.status,
      code: extractErrorCode(result.error),
      message: `Control-plane internal snapshot job failure update failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
    });
  }

  #headers(options: ControlPlaneInternalClientRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      [ControlPlaneInternalAuthHeader]: this.#internalAuthServiceToken,
    };
    const testEnvironmentId = options.testEnvironmentId ?? this.#testEnvironmentId;
    if (testEnvironmentId === undefined) {
      return headers;
    }

    if (this.#testEnvironmentIdHeader === undefined) {
      throw new Error(
        "Control-plane internal client test environment id was provided without a header name.",
      );
    }

    headers[this.#testEnvironmentIdHeader] = testEnvironmentId;
    return headers;
  }
}
