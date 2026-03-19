import { z } from "zod";

import { getControlPlaneApiClient } from "../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import type { SandboxInstancesListResult } from "./sessions-types.js";

const StartSandboxProfileInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

const SandboxInstanceStatusResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["starting", "running", "stopped", "failed"]),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

const SandboxInstanceConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const SandboxInstanceConnectStatusSchema = z
  .object({
    instanceId: z.string().min(1),
    status: z.enum(["pending", "ready", "failed", "not_resumable"]),
    code: z.string().min(1).nullable(),
    message: z.string().min(1).nullable(),
  })
  .strict();

const ConnectPollingIntervalMs = 1_000;

export type StartSandboxInstanceResult = {
  workflowRunId: string;
  sandboxInstanceId: string;
};

export type SandboxInstanceStatusResult = {
  id: string;
  status: "starting" | "running" | "stopped" | "failed";
  failureCode: string | null;
  failureMessage: string | null;
};

export type MintSandboxConnectionTokenResult = {
  instanceId: string;
  connectionUrl: string;
  connectionToken: string;
  connectionExpiresAt: string;
};

export type SandboxConnectStatusResult = {
  instanceId: string;
  status: "pending" | "ready" | "failed" | "not_resumable";
  code: string | null;
  message: string | null;
};

function createSandboxConnectError(
  connectStatus: SandboxConnectStatusResult,
): SandboxProfilesApiError {
  return new SandboxProfilesApiError({
    operation: "awaitSandboxInstanceConnectionReady",
    status: 409,
    body: connectStatus,
    message: connectStatus.message ?? "Could not establish sandbox session connection.",
    code: connectStatus.code ?? null,
  });
}

async function sleepWithSignal(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (durationMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    function cleanup(): void {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }

      signal?.removeEventListener("abort", handleAbort);
    }

    function handleTimeout(): void {
      cleanup();
      resolve();
    }

    function handleAbort(): void {
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }

    let timeoutId: number | null = window.setTimeout(handleTimeout, durationMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function listSandboxInstances(input: {
  limit: number;
  after: string | null;
  before: string | null;
  signal?: AbortSignal;
}): Promise<SandboxInstancesListResult> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET("/v1/sandbox/instances", {
      credentials: "include",
      params: {
        query: {
          limit: input.limit,
          ...(input.after === null ? {} : { after: input.after }),
          ...(input.before === null ? {} : { before: input.before }),
        },
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "listSandboxInstances",
        status: 500,
        body: null,
        message: "Sandbox instances list response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "listSandboxInstances",
        error,
        fallbackMessage: "Could not load sandbox instances.",
      }),
    );
  }
}

export async function startSandboxInstanceFromProfileVersion(input: {
  profileId: string;
  profileVersion: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<StartSandboxInstanceResult> {
  try {
    const response = await requestControlPlane({
      operation: "startSandboxInstanceFromProfileVersion",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(input.profileVersion)}/instances`,
      body:
        input.idempotencyKey === undefined
          ? {}
          : {
              idempotencyKey: input.idempotencyKey,
            },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not start sandbox session.",
    });

    const responseBody = await response.json();
    const parsedResponse = StartSandboxProfileInstanceResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "startSandboxInstanceFromProfileVersion",
        status: 500,
        body: responseBody,
        message: "Start sandbox instance response payload is invalid.",
      });
    }

    return {
      workflowRunId: parsedResponse.data.workflowRunId,
      sandboxInstanceId: parsedResponse.data.sandboxInstanceId,
    };
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "startSandboxInstanceFromProfileVersion",
        error,
        fallbackMessage: "Could not start sandbox session.",
      }),
    );
  }
}

export async function getSandboxInstanceStatus(input: {
  instanceId: string;
  signal?: AbortSignal;
}): Promise<SandboxInstanceStatusResult> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxInstanceStatus",
      method: "GET",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not check sandbox session status.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxInstanceStatusResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxInstanceStatus",
        status: 500,
        body: responseBody,
        message: "Sandbox instance status response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxInstanceStatus",
        error,
        fallbackMessage: "Could not check sandbox session status.",
      }),
    );
  }
}

export async function mintSandboxInstanceConnectionToken(input: {
  instanceId: string;
  signal?: AbortSignal;
}): Promise<MintSandboxConnectionTokenResult> {
  try {
    const response = await requestControlPlane({
      operation: "mintSandboxInstanceConnectionToken",
      method: "POST",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/connection-tokens`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not establish sandbox session connection.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxInstanceConnectionTokenSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "mintSandboxInstanceConnectionToken",
        status: 500,
        body: responseBody,
        message: "Sandbox instance connection token response payload is invalid.",
      });
    }

    return {
      instanceId: parsedResponse.data.instanceId,
      connectionUrl: parsedResponse.data.url,
      connectionToken: parsedResponse.data.token,
      connectionExpiresAt: parsedResponse.data.expiresAt,
    };
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "mintSandboxInstanceConnectionToken",
        error,
        fallbackMessage: "Could not establish sandbox session.",
      }),
    );
  }
}

export async function connectSandboxInstance(input: {
  instanceId: string;
  signal?: AbortSignal;
}): Promise<SandboxConnectStatusResult> {
  try {
    const response = await requestControlPlane({
      operation: "connectSandboxInstance",
      method: "POST",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/connect`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not start sandbox session connection.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxInstanceConnectStatusSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "connectSandboxInstance",
        status: 500,
        body: responseBody,
        message: "Sandbox instance connect response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "connectSandboxInstance",
        error,
        fallbackMessage: "Could not start sandbox session connection.",
      }),
    );
  }
}

export async function getSandboxConnectStatus(input: {
  instanceId: string;
  signal?: AbortSignal;
}): Promise<SandboxConnectStatusResult> {
  try {
    const response = await requestControlPlane({
      operation: "getSandboxConnectStatus",
      method: "GET",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/connect`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not check sandbox session connection status.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxInstanceConnectStatusSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "getSandboxConnectStatus",
        status: 500,
        body: responseBody,
        message: "Sandbox connect status response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "getSandboxConnectStatus",
        error,
        fallbackMessage: "Could not check sandbox session connection status.",
      }),
    );
  }
}

export async function awaitSandboxInstanceConnectionReady(input: {
  instanceId: string;
  signal?: AbortSignal;
}): Promise<SandboxConnectStatusResult> {
  const initialStatus = await connectSandboxInstance(input);

  if (initialStatus.status === "ready") {
    return initialStatus;
  }

  if (initialStatus.status !== "pending") {
    throw createSandboxConnectError(initialStatus);
  }

  while (true) {
    await sleepWithSignal(ConnectPollingIntervalMs, input.signal);
    const currentStatus = await getSandboxConnectStatus(input);

    if (currentStatus.status === "pending") {
      continue;
    }

    if (currentStatus.status === "ready") {
      return currentStatus;
    }

    throw createSandboxConnectError(currentStatus);
  }
}
