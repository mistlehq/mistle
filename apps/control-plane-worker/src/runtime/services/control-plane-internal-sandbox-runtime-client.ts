const CONTROL_PLANE_INTERNAL_AUTH_HEADER = "x-mistle-service-token";
const START_PROFILE_INSTANCE_PATH = "/internal/sandbox-runtime/start-profile-instance";
const MINT_CONNECTION_TOKEN_PATH = "/internal/sandbox-runtime/mint-connection-token";
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;

type CreateControlPlaneInternalSandboxRuntimeClientInput = {
  baseUrl: string;
  internalAuthServiceToken: string;
  requestTimeoutMs?: number;
};

export type StartSandboxProfileInstanceFromInternalApiInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  startedBy: {
    kind: "user" | "system";
    id: string;
  };
  source: "dashboard" | "webhook";
};

export type StartSandboxProfileInstanceFromInternalApiOutput = {
  workflowRunId: string;
  sandboxInstanceId: string;
  providerSandboxId: string;
};

export type MintSandboxConnectionFromInternalApiInput = {
  organizationId: string;
  instanceId: string;
};

export type MintSandboxConnectionFromInternalApiOutput = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

function toRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  return Object.fromEntries(Object.entries(input));
}

function parseErrorMessage(input: unknown): string {
  const parsedRecord = toRecord(input);
  if (parsedRecord === null) {
    return "Unknown control-plane internal sandbox runtime error.";
  }

  const message = parsedRecord["message"];
  if (typeof message !== "string" || message.length === 0) {
    return "Unknown control-plane internal sandbox runtime error.";
  }

  return message;
}

function parseStartProfileInstanceResponse(
  input: unknown,
): StartSandboxProfileInstanceFromInternalApiOutput {
  const parsedRecord = toRecord(input);
  if (parsedRecord === null) {
    throw new Error("Control-plane start profile instance response payload is invalid.");
  }

  const workflowRunId = parsedRecord["workflowRunId"];
  const sandboxInstanceId = parsedRecord["sandboxInstanceId"];
  const providerSandboxId = parsedRecord["providerSandboxId"];

  if (typeof workflowRunId !== "string" || workflowRunId.length === 0) {
    throw new Error(
      "Control-plane start profile instance response payload is missing workflowRunId.",
    );
  }
  if (typeof sandboxInstanceId !== "string" || sandboxInstanceId.length === 0) {
    throw new Error(
      "Control-plane start profile instance response payload is missing sandboxInstanceId.",
    );
  }
  if (typeof providerSandboxId !== "string" || providerSandboxId.length === 0) {
    throw new Error(
      "Control-plane start profile instance response payload is missing providerSandboxId.",
    );
  }

  return {
    workflowRunId,
    sandboxInstanceId,
    providerSandboxId,
  };
}

function parseMintConnectionResponse(input: unknown): MintSandboxConnectionFromInternalApiOutput {
  const parsedRecord = toRecord(input);
  if (parsedRecord === null) {
    throw new Error("Control-plane mint connection response payload is invalid.");
  }

  const instanceId = parsedRecord["instanceId"];
  const url = parsedRecord["url"];
  const token = parsedRecord["token"];
  const expiresAt = parsedRecord["expiresAt"];

  if (typeof instanceId !== "string" || instanceId.length === 0) {
    throw new Error("Control-plane mint connection response payload is missing instanceId.");
  }
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("Control-plane mint connection response payload is missing url.");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Control-plane mint connection response payload is missing token.");
  }
  if (typeof expiresAt !== "string" || expiresAt.length === 0) {
    throw new Error("Control-plane mint connection response payload is missing expiresAt.");
  }

  return {
    instanceId,
    url,
    token,
    expiresAt,
  };
}

export class ControlPlaneInternalSandboxRuntimeClient {
  readonly #startProfileInstanceEndpoint: string;
  readonly #mintConnectionTokenEndpoint: string;
  readonly #internalAuthServiceToken: string;
  readonly #requestTimeoutMs: number;

  constructor(input: CreateControlPlaneInternalSandboxRuntimeClientInput) {
    this.#startProfileInstanceEndpoint = new URL(
      START_PROFILE_INSTANCE_PATH,
      input.baseUrl,
    ).toString();
    this.#mintConnectionTokenEndpoint = new URL(
      MINT_CONNECTION_TOKEN_PATH,
      input.baseUrl,
    ).toString();
    this.#internalAuthServiceToken = input.internalAuthServiceToken;
    this.#requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async startProfileInstance(
    input: StartSandboxProfileInstanceFromInternalApiInput,
  ): Promise<StartSandboxProfileInstanceFromInternalApiOutput> {
    const response = await fetch(this.#startProfileInstanceEndpoint, {
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
        .catch((): unknown => ({ message: "Unknown control-plane start profile instance error." }));
      const message = parseErrorMessage(responseBody);
      throw new Error(
        `Control-plane start profile instance request failed with status ${String(response.status)}: ${message}`,
      );
    }

    const responseBody: unknown = await response.json();
    return parseStartProfileInstanceResponse(responseBody);
  }

  async mintConnectionToken(
    input: MintSandboxConnectionFromInternalApiInput,
  ): Promise<MintSandboxConnectionFromInternalApiOutput> {
    const response = await fetch(this.#mintConnectionTokenEndpoint, {
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
        .catch((): unknown => ({ message: "Unknown control-plane mint connection token error." }));
      const message = parseErrorMessage(responseBody);
      throw new Error(
        `Control-plane mint connection token request failed with status ${String(response.status)}: ${message}`,
      );
    }

    const responseBody: unknown = await response.json();
    return parseMintConnectionResponse(responseBody);
  }
}
