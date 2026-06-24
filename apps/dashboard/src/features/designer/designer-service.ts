import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import type { MintSandboxConnectionTokenResult } from "../sessions/sessions-service.js";
import { DesignerApiError } from "./designer-api-errors.js";
import {
  DesignerBlueprintCurrentTabHref,
  DesignerBlueprintCurrentTabId,
  DesignerBlueprintDocumentSchema,
} from "./designer-blueprint-schema.js";

const AgentRuntimeIdSchema = z.enum(["claude-code", "codex", "opencode", "pi"]);

const DesignerSessionRouteCanvasTabSchema = z
  .object({
    kind: z.literal("route"),
    id: z.string().min(1),
    title: z.string().min(1),
    href: z.string().min(1),
  })
  .strict();

const DesignerSessionBlueprintCanvasTabSchema = z
  .object({
    kind: z.literal("blueprint"),
    id: z.literal(DesignerBlueprintCurrentTabId),
    title: z.string().min(1),
    href: z.literal(DesignerBlueprintCurrentTabHref),
    blueprint: DesignerBlueprintDocumentSchema,
  })
  .strict();

const DesignerSessionCanvasTabSchema = z.discriminatedUnion("kind", [
  DesignerSessionRouteCanvasTabSchema,
  DesignerSessionBlueprintCanvasTabSchema,
]);

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
    items: z.array(DesignerSessionSchema.omit({ canvasTabs: true })),
  })
  .strict();

const DesignerSessionConnectionTokenSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

export type DesignerSession = z.output<typeof DesignerSessionSchema>;
export type DesignerSessionListItem = z.output<
  typeof ListDesignerSessionsResponseSchema
>["items"][number];
export type DesignerSessionCanvasTab = z.output<typeof DesignerSessionCanvasTabSchema>;

export const designerSessionsQueryKey = ["designer", "sessions"] as const;
export function designerSessionQueryKey(sessionId: string) {
  return ["designer", "sessions", sessionId] as const;
}

export function createPutDesignerSessionCanvasTabsRequestBody(input: {
  tabs: readonly DesignerSessionCanvasTab[];
}): { tabs: readonly DesignerSessionCanvasTab[] } {
  return {
    tabs: input.tabs,
  };
}

export async function listDesignerSessions(input?: {
  signal?: AbortSignal;
}): Promise<readonly DesignerSessionListItem[]> {
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

export async function mintDesignerSessionConnectionToken(input: {
  sessionId: string;
  signal?: AbortSignal;
}): Promise<MintSandboxConnectionTokenResult> {
  try {
    const response = await requestControlPlane({
      operation: "mintDesignerSessionConnectionToken",
      method: "POST",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/connection-token`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not establish Designer session connection.",
    });

    const responseBody = await response.json();
    const parsedResponse = DesignerSessionConnectionTokenSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "mintDesignerSessionConnectionToken",
        status: 500,
        body: responseBody,
        message: "Designer session connection token response payload is invalid.",
      });
    }

    return {
      instanceId: parsedResponse.data.instanceId,
      connectionUrl: parsedResponse.data.url,
      connectionToken: parsedResponse.data.token,
      connectionExpiresAt: parsedResponse.data.expiresAt,
    };
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "mintDesignerSessionConnectionToken",
        error,
        fallbackMessage: "Could not establish Designer session connection.",
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
      body: createPutDesignerSessionCanvasTabsRequestBody({
        tabs: input.tabs,
      }),
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
