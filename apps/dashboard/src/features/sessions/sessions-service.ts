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
    title: z.string().min(1).nullable(),
    status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    runtimeContext: z
      .object({
        launchCwd: z.string().min(1).nullable(),
        primaryRepositoryRoot: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
    automationConversation: z
      .object({
        conversationId: z.string().min(1),
        routeId: z.string().min(1).nullable(),
        providerConversationId: z.string().min(1).nullable(),
      })
      .nullable(),
  })
  .strict();

const SandboxInstanceRuntimeContextSchema =
  SandboxInstanceStatusResponseSchema.shape.runtimeContext;

const SandboxInstanceConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const SandboxInstancePortAccessSchema = z
  .object({
    bootstrapPath: z.literal("/_mistle/access/bootstrap"),
    bootstrapUrl: z.url(),
    expiresAt: z.string().min(1),
    host: z.string().min(1),
    token: z.string().min(1),
  })
  .strict();

const PatchSandboxInstanceTitleResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export type StartSandboxInstanceResult = {
  workflowRunId: string;
  sandboxInstanceId: string;
};

export type SandboxInstanceRuntimeContext = z.output<typeof SandboxInstanceRuntimeContextSchema>;

export type SandboxInstanceStatusResult = z.output<typeof SandboxInstanceStatusResponseSchema>;

export type MintSandboxConnectionTokenResult = {
  instanceId: string;
  connectionUrl: string;
  connectionToken: string;
  connectionExpiresAt: string;
};

export type CreateSandboxInstancePortAccessResult = z.output<
  typeof SandboxInstancePortAccessSchema
>;

export type ResumeSandboxInstanceResult = SandboxInstanceStatusResult;

export type PatchSandboxInstanceTitleResult = {
  id: string;
  title: string;
  updatedAt: string;
};

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
  primaryRepositoryId: string | null;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<StartSandboxInstanceResult> {
  try {
    const response = await requestControlPlane({
      operation: "startSandboxInstanceFromProfileVersion",
      method: "POST",
      pathname: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/${String(input.profileVersion)}/instances`,
      body: {
        primaryRepositoryId: input.primaryRepositoryId,
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
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

export async function createSandboxInstancePortAccess(input: {
  instanceId: string;
  port: number;
  signal?: AbortSignal;
}): Promise<CreateSandboxInstancePortAccessResult> {
  try {
    const response = await requestControlPlane({
      operation: "createSandboxInstancePortAccess",
      method: "POST",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/ports/${String(input.port)}/access`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not create sandbox port access.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxInstancePortAccessSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "createSandboxInstancePortAccess",
        status: 500,
        body: responseBody,
        message: "Sandbox instance port access response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "createSandboxInstancePortAccess",
        error,
        fallbackMessage: "Could not create sandbox port access.",
      }),
    );
  }
}

export async function patchSandboxInstanceTitle(input: {
  instanceId: string;
  onlyIfUnset?: boolean;
  title: string;
  signal?: AbortSignal;
}): Promise<PatchSandboxInstanceTitleResult> {
  try {
    const response = await requestControlPlane({
      operation: "patchSandboxInstanceTitle",
      method: "PATCH",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/title`,
      body: {
        ...(input.onlyIfUnset === undefined ? {} : { onlyIfUnset: input.onlyIfUnset }),
        title: input.title,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not update sandbox session title.",
    });

    const responseBody = await response.json();
    const parsedResponse = PatchSandboxInstanceTitleResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "patchSandboxInstanceTitle",
        status: 500,
        body: responseBody,
        message: "Patch sandbox instance title response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "patchSandboxInstanceTitle",
        error,
        fallbackMessage: "Could not update sandbox session title.",
      }),
    );
  }
}

export async function resumeSandboxInstance(input: {
  instanceId: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<ResumeSandboxInstanceResult> {
  try {
    const response = await requestControlPlane({
      operation: "resumeSandboxInstance",
      method: "POST",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/resume`,
      body:
        input.idempotencyKey === undefined
          ? {}
          : {
              idempotencyKey: input.idempotencyKey,
            },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not resume sandbox session.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxInstanceStatusResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "resumeSandboxInstance",
        status: 500,
        body: responseBody,
        message: "Resume sandbox instance response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "resumeSandboxInstance",
        error,
        fallbackMessage: "Could not resume sandbox session.",
      }),
    );
  }
}
