import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";

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
