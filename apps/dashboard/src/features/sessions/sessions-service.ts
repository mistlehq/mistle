import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { z } from "zod";

import { getControlPlaneApiClient } from "../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import type { SandboxInstancesListResult, SandboxOperationEventsResult } from "./sessions-types.js";

const AgentRuntimeIdSchema = z.enum(["codex", "opencode", "pi"]);

const StartSandboxProfileInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

const SandboxInstanceStatusApiResponseSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    title: z.string().min(1).nullable(),
    status: z.enum([
      SandboxInstanceStatuses.PENDING,
      SandboxInstanceStatuses.STARTING,
      SandboxInstanceStatuses.STARTED,
      SandboxInstanceStatuses.INITIALIZING,
      SandboxInstanceStatuses.RUNNING,
      SandboxInstanceStatuses.RECONNECTING,
      SandboxInstanceStatuses.STOPPING,
      SandboxInstanceStatuses.STOPPED,
      SandboxInstanceStatuses.FAILED,
    ]),
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    runtimeContext: z
      .object({
        agentRuntimeId: AgentRuntimeIdSchema.nullable(),
        launchCwd: z.string().min(1).nullable(),
        primaryRepositoryRoot: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
    triggerConversation: z
      .object({
        conversationId: z.string().min(1),
        routeId: z.string().min(1).nullable(),
        providerConversationId: z.string().min(1).nullable(),
      })
      .nullable(),
    startupOperation: z
      .object({
        operationId: z.string().min(1),
        operationKind: z.enum(["start", "resume"]),
      })
      .strict()
      .nullable(),
  })
  .strict();

const SandboxInstanceRuntimeContextSchema =
  SandboxInstanceStatusApiResponseSchema.shape.runtimeContext;

const SandboxInstanceStatusResponseSchema = SandboxInstanceStatusApiResponseSchema.transform(
  ({ triggerConversation, ...status }) => ({
    ...status,
    triggerConversation: triggerConversation,
  }),
);

const SandboxInstanceConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const SandboxInstancePtySessionSchema = z
  .object({
    expiresAt: z.string().min(1),
    instanceId: z.string().min(1),
    ptySessionId: z.string().min(1),
    token: z.string().min(1),
    url: z.url(),
  })
  .strict();

const SandboxInstancePortAccessSchema = z
  .object({
    expiresAt: z.string().min(1),
    host: z.string().min(1),
    url: z.url(),
  })
  .strict();

const PortAccessLinkRedemptionSchema = z
  .object({
    url: z.url(),
  })
  .strict();

const PatchSandboxInstanceTitleResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const StopSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["accepted", "already_stopped", "already_terminal"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();

const DeleteSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["deleted", "already_deleted"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
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

export type CreateSandboxInstancePtySessionResult = z.output<
  typeof SandboxInstancePtySessionSchema
>;

export type CreateSandboxInstancePortAccessResult = z.output<
  typeof SandboxInstancePortAccessSchema
>;

export type ResumeSandboxInstanceResult = SandboxInstanceStatusResult;

export type PatchSandboxInstanceTitleResult = {
  id: string;
  title: string;
  updatedAt: string;
};

export type StopSandboxInstanceResult = z.output<typeof StopSandboxInstanceResponseSchema>;
export type DeleteSandboxInstanceResult = z.output<typeof DeleteSandboxInstanceResponseSchema>;

export async function listSandboxInstances(input: {
  limit: number;
  after: string | null;
  before: string | null;
  search?: string;
  owner?: "me";
  startedFrom?: "manual" | "trigger" | "event" | "schedule";
  triggerId?: string;
  signal?: AbortSignal;
}): Promise<SandboxInstancesListResult> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET("/v1/sandbox/instances", {
      credentials: "include",
      params: {
        query: {
          limit: input.limit,
          ...(input.search === undefined ? {} : { search: input.search }),
          ...(input.owner === undefined ? {} : { owner: input.owner }),
          ...(input.startedFrom === undefined ? {} : { startedFrom: input.startedFrom }),
          ...(input.triggerId === undefined ? {} : { triggerId: input.triggerId }),
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

export async function listSandboxOperationEvents(input: {
  afterSequence?: number;
  instanceId: string;
  limit?: number;
  operationId: string;
  signal?: AbortSignal;
}): Promise<SandboxOperationEventsResult> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET("/v1/sandbox/instances/{instanceId}/operation-events", {
      credentials: "include",
      params: {
        path: {
          instanceId: input.instanceId,
        },
        query: {
          operationId: input.operationId,
          ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (data === undefined) {
      throw new SandboxProfilesApiError({
        operation: "listSandboxOperationEvents",
        status: 500,
        body: null,
        message: "Sandbox operation events response was empty.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "listSandboxOperationEvents",
        error,
        fallbackMessage: "Could not load sandbox operation progress.",
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

export async function createSandboxInstancePtySession(input: {
  instanceId: string;
  ptySessionId: string;
  signal?: AbortSignal;
}): Promise<CreateSandboxInstancePtySessionResult> {
  try {
    const response = await requestControlPlane({
      operation: "createSandboxInstancePtySession",
      method: "POST",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/pty-sessions`,
      body: {
        ptySessionId: input.ptySessionId,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not establish sandbox PTY session.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxInstancePtySessionSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "createSandboxInstancePtySession",
        status: 500,
        body: responseBody,
        message: "Sandbox instance PTY session response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "createSandboxInstancePtySession",
        error,
        fallbackMessage: "Could not establish sandbox PTY session.",
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

export async function redeemPortAccessLink(input: {
  slug: string;
  signal?: AbortSignal;
}): Promise<string> {
  try {
    const response = await requestControlPlane({
      operation: "redeemPortAccessLink",
      method: "GET",
      pathname: `/p/ports/${encodeURIComponent(input.slug)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not open sandbox port access.",
    });

    const responseBody = await response.json();
    const parsedResponse = PortAccessLinkRedemptionSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "redeemPortAccessLink",
        status: 500,
        body: responseBody,
        message: "Port Access link redemption response payload is invalid.",
      });
    }

    return parsedResponse.data.url;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "redeemPortAccessLink",
        error,
        fallbackMessage: "Could not open sandbox port access.",
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

export async function stopSandboxInstance(input: {
  instanceId: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<StopSandboxInstanceResult> {
  try {
    const response = await requestControlPlane({
      operation: "stopSandboxInstance",
      method: "POST",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}/stop`,
      body: {
        idempotencyKey: input.idempotencyKey,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not stop sandbox session.",
    });

    const responseBody = await response.json();
    const parsedResponse = StopSandboxInstanceResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "stopSandboxInstance",
        status: 500,
        body: responseBody,
        message: "Stop sandbox instance response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "stopSandboxInstance",
        error,
        fallbackMessage: "Could not stop sandbox session.",
      }),
    );
  }
}

export async function deleteSandboxInstance(input: {
  instanceId: string;
  signal?: AbortSignal;
}): Promise<DeleteSandboxInstanceResult> {
  try {
    const response = await requestControlPlane({
      operation: "deleteSandboxInstance",
      method: "DELETE",
      pathname: `/v1/sandbox/instances/${encodeURIComponent(input.instanceId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not delete sandbox session.",
    });

    const responseBody = await response.json();
    const parsedResponse = DeleteSandboxInstanceResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "deleteSandboxInstance",
        status: 500,
        body: responseBody,
        message: "Delete sandbox session response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "deleteSandboxInstance",
        error,
        fallbackMessage: "Could not delete sandbox session.",
      }),
    );
  }
}
