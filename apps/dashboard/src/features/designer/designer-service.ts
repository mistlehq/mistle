import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { DesignerApiError } from "./designer-api-errors.js";

const DesignerSessionCanvasTabSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    href: z.string().min(1),
  })
  .strict();

const DesignerSessionSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    initialPrompt: z.string().min(1).nullable(),
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

const BootstrapDesignerRuntimeConversationResponseSchema = z
  .object({
    runtimeConversation: z
      .object({
        providerConversationId: z.string().min(1),
        providerExecutionId: z.string().min(1).nullable(),
        initialPromptSubmittedAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const SubmitDesignerRuntimeFollowUpResponseSchema = z
  .object({
    runtimeFollowUp: z
      .object({
        providerConversationId: z.string().min(1),
        providerExecutionId: z.string().min(1).nullable(),
        submittedAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type DesignerSession = z.output<typeof DesignerSessionSchema>;
export type DesignerRuntimeConversationBootstrap = z.output<
  typeof BootstrapDesignerRuntimeConversationResponseSchema
>["runtimeConversation"];
export type DesignerRuntimeFollowUpSubmission = z.output<
  typeof SubmitDesignerRuntimeFollowUpResponseSchema
>["runtimeFollowUp"];

export const designerSessionsQueryKey = ["designer", "sessions"] as const;
export const designerRuntimeConversationBootstrapQueryKey = [
  "designer",
  "runtime-conversation-bootstrap",
] as const;

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
  prompt: string;
  signal?: AbortSignal;
}): Promise<DesignerSession> {
  try {
    const response = await requestControlPlane({
      operation: "createDesignerSession",
      method: "POST",
      pathname: "/v1/designer/sessions",
      body: {
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

export async function bootstrapDesignerRuntimeConversation(input: {
  sessionId: string;
  signal?: AbortSignal;
}): Promise<DesignerRuntimeConversationBootstrap> {
  try {
    const response = await requestControlPlane({
      operation: "bootstrapDesignerRuntimeConversation",
      method: "POST",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/runtime-conversation`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not prepare Designer runtime conversation.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      BootstrapDesignerRuntimeConversationResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "bootstrapDesignerRuntimeConversation",
        status: 500,
        body: responseBody,
        message: "Designer runtime conversation bootstrap response payload is invalid.",
      });
    }

    return parsedResponse.data.runtimeConversation;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "bootstrapDesignerRuntimeConversation",
        error,
        fallbackMessage: "Could not prepare Designer runtime conversation.",
      }),
    );
  }
}

export async function submitDesignerRuntimeFollowUp(input: {
  sessionId: string;
  prompt: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<DesignerRuntimeFollowUpSubmission> {
  try {
    const response = await requestControlPlane({
      operation: "submitDesignerRuntimeFollowUp",
      method: "POST",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/runtime-conversation/follow-ups`,
      body: {
        prompt: input.prompt,
        idempotencyKey: input.idempotencyKey,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not submit Designer follow-up.",
    });

    const responseBody = await response.json();
    const parsedResponse = SubmitDesignerRuntimeFollowUpResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "submitDesignerRuntimeFollowUp",
        status: 500,
        body: responseBody,
        message: "Designer runtime follow-up response payload is invalid.",
      });
    }

    return parsedResponse.data.runtimeFollowUp;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "submitDesignerRuntimeFollowUp",
        error,
        fallbackMessage: "Could not submit Designer follow-up.",
      }),
    );
  }
}
