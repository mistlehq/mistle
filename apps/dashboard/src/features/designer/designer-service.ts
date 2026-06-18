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
    startupOperation: DesignerSessionStartupOperationSchema.nullable(),
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

const DesignerActionProposalResponseSchema = z.enum(["approved", "declined"]);

const DesignerSandboxProfileDraftSetupScriptPutResultSchema = z
  .object({
    kind: z.literal("sandboxProfileDraftSetupScriptPut"),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
  })
  .strict();

const DesignerSandboxProfileDraftPublishResultSchema = z
  .object({
    kind: z.literal("sandboxProfileDraftPublish"),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
    publishedAt: z.string().min(1),
    snapshotAction: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("created"),
          snapshotJobId: z.string().min(1),
          sandboxInstanceId: z.string().min(1).nullable(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("reused"),
          snapshotImageProvider: z.string().min(1),
          snapshotImageId: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict();

const DesignerSandboxProfileVersionLaunchResultSchema = z
  .object({
    kind: z.literal("sandboxProfileVersionLaunch"),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const DesignerActionRequestOperationResultSchema = z
  .discriminatedUnion("kind", [
    DesignerSandboxProfileDraftPublishResultSchema,
    DesignerSandboxProfileDraftSetupScriptPutResultSchema,
    DesignerSandboxProfileVersionLaunchResultSchema,
  ])
  .nullable();

const DesignerActionRequestSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum([
      "approved",
      "declined",
      "executing",
      "execution_unsupported",
      "completed",
      "failed",
    ]),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    operationResult: DesignerActionRequestOperationResultSchema,
  })
  .strict();

const SubmitDesignerActionProposalResponseResponseSchema = z
  .object({
    actionProposalResponse: z
      .object({
        proposalId: z.string().min(1),
        response: DesignerActionProposalResponseSchema,
        providerConversationId: z.string().min(1),
        providerExecutionId: z.string().min(1).nullable(),
        submittedAt: z.string().min(1),
      })
      .strict(),
    actionRequest: DesignerActionRequestSchema,
  })
  .strict();

const DesignerRuntimeConversationTranscriptTurnSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1).nullable(),
    items: z.array(z.unknown()),
  })
  .strict();

const DesignerUserInputRequestIdSchema = z.union([z.string().min(1), z.number()]);

const DesignerUserInputRequestOptionSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().min(1).nullable(),
    isOther: z.boolean(),
  })
  .strict();

const DesignerUserInputRequestQuestionSchema = z
  .object({
    header: z.string().min(1).nullable(),
    id: z.string().min(1),
    options: z.array(DesignerUserInputRequestOptionSchema),
    question: z.string().min(1),
  })
  .strict();

const DesignerUserInputRequestSchema = z
  .object({
    requestId: DesignerUserInputRequestIdSchema,
    method: z.literal("tool/requestUserInput"),
    kind: z.literal("tool-user-input"),
    questions: z.array(DesignerUserInputRequestQuestionSchema),
    status: z.enum(["pending", "responding"]),
    responseErrorMessage: z.string().min(1).nullable(),
  })
  .strict();

const DesignerActionProposalDetailSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();

const DesignerProviderConfigurationChangeOperationSchema = z
  .object({
    kind: z.literal("providerConfigurationChange"),
    provider: z.string().min(1),
    resourceType: z.string().min(1),
    resourceLabel: z.string().min(1).nullable(),
    action: z.string().min(1),
    details: z.array(DesignerActionProposalDetailSchema),
  })
  .strict();

const DesignerSandboxProfileDraftSetupScriptPutOperationSchema = z
  .object({
    kind: z.literal("sandboxProfileDraftSetupScriptPut"),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
    setupScript: z.string().min(1).nullable(),
  })
  .strict();

const DesignerSandboxProfileDraftPublishOperationSchema = z
  .object({
    kind: z.literal("sandboxProfileDraftPublish"),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
  })
  .strict();

const DesignerSandboxProfileVersionLaunchOperationSchema = z
  .object({
    kind: z.literal("sandboxProfileVersionLaunch"),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable().optional(),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const DesignerActionProposalSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("designerActionProposal"),
    title: z.string().min(1),
    summary: z.string().min(1),
    status: z.enum([
      "pending",
      "approved",
      "declined",
      "executing",
      "execution_unsupported",
      "completed",
      "failed",
    ]),
    operation: z.discriminatedUnion("kind", [
      DesignerProviderConfigurationChangeOperationSchema,
      DesignerSandboxProfileDraftPublishOperationSchema,
      DesignerSandboxProfileDraftSetupScriptPutOperationSchema,
      DesignerSandboxProfileVersionLaunchOperationSchema,
    ]),
    actionRequest: DesignerActionRequestSchema.nullable(),
  })
  .strict();

const GetDesignerRuntimeConversationTranscriptResponseSchema = z
  .object({
    runtimeConversationTranscript: z
      .object({
        providerConversationId: z.string().min(1),
        name: z.string().nullable(),
        preview: z.string().nullable(),
        turns: z.array(DesignerRuntimeConversationTranscriptTurnSchema),
        actionProposals: z.array(DesignerActionProposalSchema),
        userInputRequests: z.array(DesignerUserInputRequestSchema),
      })
      .strict(),
  })
  .strict();

const SubmitDesignerUserInputRequestResponseResponseSchema = z
  .object({
    userInputRequestResponse: z
      .object({
        requestId: DesignerUserInputRequestIdSchema,
        providerConversationId: z.string().min(1),
        submittedAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const SubmitDesignerUserInputRequestResponseBodySchema = z
  .object({
    answers: z.array(
      z
        .object({
          id: z.string().min(1),
          value: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type DesignerSession = z.output<typeof DesignerSessionSchema>;
export type DesignerRuntimeConversationBootstrap = z.output<
  typeof BootstrapDesignerRuntimeConversationResponseSchema
>["runtimeConversation"];
export type DesignerRuntimeFollowUpSubmission = z.output<
  typeof SubmitDesignerRuntimeFollowUpResponseSchema
>["runtimeFollowUp"];
export type DesignerActionProposalResponse = z.output<typeof DesignerActionProposalResponseSchema>;
export type DesignerActionProposalResponseResult = z.output<
  typeof SubmitDesignerActionProposalResponseResponseSchema
>;
export type DesignerUserInputRequestResponseResult = z.output<
  typeof SubmitDesignerUserInputRequestResponseResponseSchema
>;
export type DesignerRuntimeConversationTranscript = z.output<
  typeof GetDesignerRuntimeConversationTranscriptResponseSchema
>["runtimeConversationTranscript"];
export type DesignerActionProposal = z.output<typeof DesignerActionProposalSchema>;

export const designerSessionsQueryKey = ["designer", "sessions"] as const;
export const designerRuntimeConversationBootstrapQueryKey = [
  "designer",
  "runtime-conversation-bootstrap",
] as const;
export const designerRuntimeConversationTranscriptQueryKey = [
  "designer",
  "runtime-conversation-transcript",
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

export async function submitDesignerActionProposalResponse(input: {
  sessionId: string;
  proposalId: string;
  response: DesignerActionProposalResponse;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<DesignerActionProposalResponseResult> {
  try {
    const response = await requestControlPlane({
      operation: "submitDesignerActionProposalResponse",
      method: "POST",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/runtime-conversation/action-proposals/${encodeURIComponent(input.proposalId)}/responses`,
      body: {
        response: input.response,
        idempotencyKey: input.idempotencyKey,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not submit Designer action proposal response.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SubmitDesignerActionProposalResponseResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "submitDesignerActionProposalResponse",
        status: 500,
        body: responseBody,
        message: "Designer action proposal response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "submitDesignerActionProposalResponse",
        error,
        fallbackMessage: "Could not submit Designer action proposal response.",
      }),
    );
  }
}

export async function submitDesignerUserInputRequestResponse(input: {
  sessionId: string;
  requestId: string | number;
  result: unknown;
  signal?: AbortSignal;
}): Promise<DesignerUserInputRequestResponseResult> {
  try {
    const requestBody = SubmitDesignerUserInputRequestResponseBodySchema.parse(input.result);
    const response = await requestControlPlane({
      operation: "submitDesignerUserInputRequestResponse",
      method: "POST",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/runtime-conversation/user-input-requests/${encodeURIComponent(String(input.requestId))}/responses`,
      body: requestBody,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not submit Designer user input response.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      SubmitDesignerUserInputRequestResponseResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "submitDesignerUserInputRequestResponse",
        status: 500,
        body: responseBody,
        message: "Designer user input response payload is invalid.",
      });
    }

    return parsedResponse.data;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "submitDesignerUserInputRequestResponse",
        error,
        fallbackMessage: "Could not submit Designer user input response.",
      }),
    );
  }
}

export async function getDesignerRuntimeConversationTranscript(input: {
  sessionId: string;
  signal?: AbortSignal;
}): Promise<DesignerRuntimeConversationTranscript> {
  try {
    const response = await requestControlPlane({
      operation: "getDesignerRuntimeConversationTranscript",
      method: "GET",
      pathname: `/v1/designer/sessions/${encodeURIComponent(input.sessionId)}/runtime-conversation/transcript`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load Designer runtime conversation transcript.",
    });

    const responseBody = await response.json();
    const parsedResponse =
      GetDesignerRuntimeConversationTranscriptResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new DesignerApiError({
        operation: "getDesignerRuntimeConversationTranscript",
        status: 500,
        body: responseBody,
        message: "Designer runtime conversation transcript response payload is invalid.",
      });
    }

    return parsedResponse.data.runtimeConversationTranscript;
  } catch (error) {
    throw new DesignerApiError(
      normalizeHttpApiError({
        operation: "getDesignerRuntimeConversationTranscript",
        error,
        fallbackMessage: "Could not load Designer runtime conversation transcript.",
      }),
    );
  }
}
