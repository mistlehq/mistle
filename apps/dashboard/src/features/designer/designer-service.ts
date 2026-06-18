import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { DesignerApiError } from "./designer-api-errors.js";

const AgentRuntimeIdSchema = z.enum(["claude-code", "codex", "opencode", "pi"]);

const DesignerSessionCanvasTabSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    href: z.string().min(1),
  })
  .strict();

const DesignerSessionStartupOperationSchema = z
  .object({
    operationId: z.string().min(1),
    operationKind: z.enum(["start", "resume"]),
  })
  .strict();

const DesignerSessionSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    title: z.string().min(1).nullable(),
    status: z
      .enum([
        SandboxInstanceStatuses.PENDING,
        SandboxInstanceStatuses.STARTING,
        SandboxInstanceStatuses.STARTED,
        SandboxInstanceStatuses.INITIALIZING,
        SandboxInstanceStatuses.RUNNING,
        SandboxInstanceStatuses.DEGRADED,
        SandboxInstanceStatuses.RECONNECTING,
        SandboxInstanceStatuses.STOPPING,
        SandboxInstanceStatuses.STOPPED,
        SandboxInstanceStatuses.FAILED,
      ])
      .nullable(),
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
    startupOperation: DesignerSessionStartupOperationSchema.nullable(),
    initialPrompt: z.string().min(1).nullable(),
    canvasTabs: z.array(DesignerSessionCanvasTabSchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const ListDesignerSessionsResponseSchema = z
  .object({
    items: z.array(DesignerSessionSchema),
  })
  .strict();

export type DesignerSession = z.output<typeof DesignerSessionSchema>;
export type DesignerSessionCanvasTab = z.output<typeof DesignerSessionCanvasTabSchema>;

export const designerSessionsQueryKey = ["designer", "sessions"] as const;
export function designerSessionQueryKey(sessionId: string) {
  return ["designer", "sessions", sessionId] as const;
}
export function designerSessionBySandboxInstanceQueryKey(sandboxInstanceId: string) {
  return ["designer", "sandbox-instances", sandboxInstanceId] as const;
}

export async function listDesignerSessions(input?: {
  signal?: AbortSignal;
}): Promise<readonly DesignerSession[]> {
  try {
    const response = await requestControlPlane({
      operation: "listDesignerSessions",
      method: "GET",
      pathname: "/v1/designer/sessions",
      query: {
        limit: 20,
      },
      ...(input?.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load Designer sessions.",
    });

    const responseBody = await response.json();
    const parsedResponse = ListDesignerSessionsResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "listDesignerSessions",
        status: 500,
        body: responseBody,
        message: "Designer sessions response payload is invalid.",
      });
    }

    return parsedResponse.data.items;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "listDesignerSessions",
        error,
        fallbackMessage: "Could not load Designer sessions.",
      }),
    );
  }
}

export async function createDesignerSession(input: {
  idempotencyKey: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<DesignerSession> {
  try {
    const response = await requestControlPlane({
      operation: "createDesignerSession",
      method: "POST",
      pathname: "/v1/designer/sessions",
      body: {
        idempotencyKey: input.idempotencyKey,
        prompt: input.prompt,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not start Designer session.",
    });

    const responseBody = await response.json();
    const parsedResponse = DesignerSessionSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "createDesignerSession",
        status: 500,
        body: responseBody,
        message: "Create Designer session response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "createDesignerSession",
        error,
        fallbackMessage: "Could not start Designer session.",
      }),
    );
  }
}

export async function getDesignerSession(input: {
  sessionId: string;
  signal?: AbortSignal;
}): Promise<DesignerSession> {
  try {
    const response = await requestControlPlane({
      operation: "getDesignerSession",
      method: "GET",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load Designer session.",
    });

    const responseBody = await response.json();
    const parsedResponse = DesignerSessionSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "getDesignerSession",
        status: 500,
        body: responseBody,
        message: "Designer session response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "getDesignerSession",
        error,
        fallbackMessage: "Could not load Designer session.",
      }),
    );
  }
}

export async function getDesignerSessionBySandboxInstanceId(input: {
  sandboxInstanceId: string;
  signal?: AbortSignal;
}): Promise<DesignerSession> {
  try {
    const response = await requestControlPlane({
      operation: "getDesignerSessionBySandboxInstanceId",
      method: "GET",
      pathname: `/v1/designer/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load Designer session.",
    });

    const responseBody = await response.json();
    const parsedResponse = DesignerSessionSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "getDesignerSessionBySandboxInstanceId",
        status: 500,
        body: responseBody,
        message: "Designer session response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "getDesignerSessionBySandboxInstanceId",
        error,
        fallbackMessage: "Could not load Designer session.",
      }),
    );
  }
}

export async function putDesignerSessionCanvasTabs(input: {
  sessionId: string;
  tabs: readonly DesignerSessionCanvasTab[];
  signal?: AbortSignal;
}): Promise<DesignerSession> {
  try {
    const response = await requestControlPlane({
      operation: "putDesignerSessionCanvasTabs",
      method: "PUT",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/canvas-tabs`,
      body: {
        tabs: input.tabs.map((tab) => ({
          id: tab.id,
          title: tab.title,
          href: tab.href,
        })),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not save Designer canvas tabs.",
    });

    const responseBody = await response.json();
    const parsedResponse = DesignerSessionSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "putDesignerSessionCanvasTabs",
        status: 500,
        body: responseBody,
        message: "Update Designer canvas tabs response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "putDesignerSessionCanvasTabs",
        error,
        fallbackMessage: "Could not save Designer canvas tabs.",
      }),
    );
  }
}
