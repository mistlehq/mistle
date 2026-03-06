import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";

const SandboxConversationSessionResponseSchema = z
  .object({
    status: z.literal("accepted"),
    conversationId: z.string().min(1),
    routeId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
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

export type StartSandboxConversationSessionResult = {
  conversationId: string;
  routeId: string;
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

export async function startSandboxConversationSession(input: {
  profileId: string;
  profileVersion: number;
  integrationBindingId: string;
  signal?: AbortSignal;
}): Promise<StartSandboxConversationSessionResult> {
  try {
    const response = await requestControlPlane({
      operation: "startSandboxConversationSession",
      method: "POST",
      pathname: "/v1/sandbox/conversations/sessions",
      body: {
        profileId: input.profileId,
        profileVersion: input.profileVersion,
        integrationBindingId: input.integrationBindingId,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not start sandbox session.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxConversationSessionResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "startSandboxConversationSession",
        status: 500,
        body: responseBody,
        message: "Start sandbox conversation session response payload is invalid.",
      });
    }

    if (parsedResponse.data.workflowRunId === null) {
      throw new SandboxProfilesApiError({
        operation: "startSandboxConversationSession",
        status: 500,
        body: responseBody,
        message: "Expected workflowRunId for newly started sandbox conversation session.",
      });
    }

    return {
      conversationId: parsedResponse.data.conversationId,
      routeId: parsedResponse.data.routeId,
      workflowRunId: parsedResponse.data.workflowRunId,
      sandboxInstanceId: parsedResponse.data.sandboxInstanceId,
    };
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "startSandboxConversationSession",
        error,
        fallbackMessage: "Could not start sandbox session.",
      }),
    );
  }
}

export async function continueSandboxConversationSession(input: {
  conversationId: string;
  signal?: AbortSignal;
}): Promise<{
  conversationId: string;
  routeId: string;
  sandboxInstanceId: string;
  workflowRunId: string | null;
}> {
  try {
    const response = await requestControlPlane({
      operation: "continueSandboxConversationSession",
      method: "POST",
      pathname: `/v1/sandbox/conversations/${encodeURIComponent(input.conversationId)}/sessions`,
      body: {},
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not continue sandbox conversation session.",
    });

    const responseBody = await response.json();
    const parsedResponse = SandboxConversationSessionResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new SandboxProfilesApiError({
        operation: "continueSandboxConversationSession",
        status: 500,
        body: responseBody,
        message: "Continue sandbox conversation session response payload is invalid.",
      });
    }

    return {
      conversationId: parsedResponse.data.conversationId,
      routeId: parsedResponse.data.routeId,
      sandboxInstanceId: parsedResponse.data.sandboxInstanceId,
      workflowRunId: parsedResponse.data.workflowRunId,
    };
  } catch (error) {
    throw new SandboxProfilesApiError(
      normalizeHttpApiError({
        operation: "continueSandboxConversationSession",
        error,
        fallbackMessage: "Could not continue sandbox conversation session.",
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
