import { z } from "@hono/zod-openapi";
import {
  DesignerActionRequestOperationKinds,
  DesignerActionRequestStatuses,
} from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";

const designerSessionCanvasTabSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(120),
    href: z.string().min(1).max(2_048),
  })
  .strict();

const designerSessionSandboxStatusSchema = z.enum([
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
]);

const designerSessionStartupOperationSchema = z
  .object({
    operationId: z.string().min(1),
    operationKind: z.enum(["start", "resume"]),
  })
  .strict();

export const designerSessionIdParamsSchema = z
  .object({
    sessionId: z
      .string()
      .min(1)
      .regex(/^dsn_[a-zA-Z0-9_-]+$/, {
        message: "`sessionId` must be a designer session id.",
      }),
  })
  .strict();

export const designerActionProposalIdParamsSchema = designerSessionIdParamsSchema
  .extend({
    proposalId: z.string().min(1).max(255),
  })
  .strict();

export const createDesignerSessionBodySchema = z
  .object({
    prompt: z.string().trim().min(1).max(20_000),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const listDesignerSessionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const putDesignerSessionCanvasTabsBodySchema = z
  .object({
    tabs: z.array(designerSessionCanvasTabSchema).max(12),
  })
  .strict();

export const submitDesignerRuntimeFollowUpBodySchema = z
  .object({
    prompt: z.string().trim().min(1).max(20_000),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const designerActionProposalResponseSchema = z.enum(["approved", "declined"]);

export const submitDesignerActionProposalResponseBodySchema = z
  .object({
    response: designerActionProposalResponseSchema,
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

const designerUserInputRequestIdSchema = z.union([z.string().min(1), z.number()]);

export const designerUserInputRequestIdParamsSchema = designerSessionIdParamsSchema
  .extend({
    requestId: z.string().min(1).max(255),
  })
  .strict();

const designerUserInputRequestAnswerSchema = z
  .object({
    id: z.string().min(1).max(128),
    value: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const submitDesignerUserInputRequestResponseBodySchema = z
  .object({
    answers: z.array(designerUserInputRequestAnswerSchema).min(1).max(3),
  })
  .strict();

export const designerSessionSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    initialPrompt: z.string().min(1).nullable(),
    title: z.string().min(1).nullable(),
    status: designerSessionSandboxStatusSchema.nullable(),
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    startupOperation: designerSessionStartupOperationSchema.nullable(),
    canvasTabs: z.array(designerSessionCanvasTabSchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const designerRuntimeConversationSchema = z
  .object({
    providerConversationId: z.string().min(1),
    providerExecutionId: z.string().min(1).nullable(),
    initialPromptSubmittedAt: z.string().min(1),
  })
  .strict();

const designerRuntimeFollowUpSubmissionSchema = z
  .object({
    providerConversationId: z.string().min(1),
    providerExecutionId: z.string().min(1).nullable(),
    submittedAt: z.string().min(1),
  })
  .strict();

const designerActionProposalResponseSubmissionSchema = z
  .object({
    proposalId: z.string().min(1).max(255),
    response: designerActionProposalResponseSchema,
    providerConversationId: z.string().min(1),
    providerExecutionId: z.string().min(1).nullable(),
    submittedAt: z.string().min(1),
  })
  .strict();

const designerActionRequestStatusSchema = z.enum([
  DesignerActionRequestStatuses.APPROVED,
  DesignerActionRequestStatuses.DECLINED,
  DesignerActionRequestStatuses.EXECUTING,
  DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED,
  DesignerActionRequestStatuses.COMPLETED,
  DesignerActionRequestStatuses.FAILED,
]);

const designerSandboxProfileDraftSetupScriptPutResultSchema = z
  .object({
    kind: z.literal(DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_SETUP_SCRIPT_PUT),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
  })
  .strict();

const designerSandboxProfileDraftPublishResultSchema = z
  .object({
    kind: z.literal(DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_PUBLISH),
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

const designerSandboxProfileVersionLaunchResultSchema = z
  .object({
    kind: z.literal(DesignerActionRequestOperationKinds.SANDBOX_PROFILE_VERSION_LAUNCH),
    profileId: z.string().min(1),
    version: z.number().int().min(1),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const designerActionRequestOperationResultSchema = z
  .discriminatedUnion("kind", [
    designerSandboxProfileDraftPublishResultSchema,
    designerSandboxProfileDraftSetupScriptPutResultSchema,
    designerSandboxProfileVersionLaunchResultSchema,
  ])
  .nullable();

const designerActionRequestSchema = z
  .object({
    id: z.string().min(1),
    status: designerActionRequestStatusSchema,
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    operationResult: designerActionRequestOperationResultSchema,
  })
  .strict();

const designerRuntimeConversationTranscriptTurnSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1).nullable(),
    items: z.array(z.unknown()),
  })
  .strict();

const designerUserInputRequestOptionSchema = z
  .object({
    label: z.string().min(1).max(240),
    description: z.string().min(1).max(2_000).nullable(),
    isOther: z.boolean(),
  })
  .strict();

const designerUserInputRequestQuestionSchema = z
  .object({
    header: z.string().min(1).max(120).nullable(),
    id: z.string().min(1).max(128),
    options: z.array(designerUserInputRequestOptionSchema).max(12),
    question: z.string().min(1).max(2_000),
  })
  .strict();

export const designerUserInputRequestSchema = z
  .object({
    requestId: designerUserInputRequestIdSchema,
    method: z.literal("tool/requestUserInput"),
    kind: z.literal("tool-user-input"),
    questions: z.array(designerUserInputRequestQuestionSchema).min(1).max(3),
    status: z.enum(["pending", "responding"]),
    responseErrorMessage: z.string().min(1).nullable(),
  })
  .strict();

const designerActionProposalDetailSchema = z
  .object({
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(2_000),
  })
  .strict();

const designerProviderConfigurationChangeOperationSchema = z
  .object({
    kind: z.literal(DesignerActionRequestOperationKinds.PROVIDER_CONFIGURATION_CHANGE),
    provider: z.string().min(1).max(120),
    resourceType: z.string().min(1).max(120),
    resourceLabel: z.string().min(1).max(240).nullable(),
    action: z.string().min(1).max(160),
    details: z.array(designerActionProposalDetailSchema).max(20),
  })
  .strict();

const designerSandboxProfileDraftSetupScriptPutOperationSchema = z
  .object({
    kind: z.literal(DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_SETUP_SCRIPT_PUT),
    profileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`profileId` must be a sandbox profile id.",
      }),
    version: z.number().int().min(1),
    setupScript: z.string().min(1).max(200_000).nullable(),
  })
  .strict();

const designerSandboxProfileDraftPublishOperationSchema = z
  .object({
    kind: z.literal(DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_PUBLISH),
    profileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`profileId` must be a sandbox profile id.",
      }),
    version: z.number().int().min(1),
  })
  .strict();

const designerSandboxProfileVersionLaunchOperationSchema = z
  .object({
    kind: z.literal(DesignerActionRequestOperationKinds.SANDBOX_PROFILE_VERSION_LAUNCH),
    profileId: z
      .string()
      .min(1)
      .regex(/^sbp_[a-zA-Z0-9_-]+$/, {
        message: "`profileId` must be a sandbox profile id.",
      }),
    version: z.number().int().min(1),
    primaryRepositoryId: z.string().min(1).nullable().optional(),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

const designerActionProposalStatusSchema = z.enum([
  "pending",
  DesignerActionRequestStatuses.APPROVED,
  DesignerActionRequestStatuses.DECLINED,
  DesignerActionRequestStatuses.EXECUTING,
  DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED,
  DesignerActionRequestStatuses.COMPLETED,
  DesignerActionRequestStatuses.FAILED,
]);

const designerActionProposalShape = {
  id: z.string().min(1).max(255),
  kind: z.literal("designerActionProposal"),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2_000),
  operation: z.discriminatedUnion("kind", [
    designerProviderConfigurationChangeOperationSchema,
    designerSandboxProfileDraftPublishOperationSchema,
    designerSandboxProfileDraftSetupScriptPutOperationSchema,
    designerSandboxProfileVersionLaunchOperationSchema,
  ]),
};

export const designerProviderActionProposalSchema = z
  .object({
    ...designerActionProposalShape,
    status: z.enum(["pending", "approved", "declined"]),
  })
  .strict();

export const designerActionProposalSchema = z
  .object({
    ...designerActionProposalShape,
    status: designerActionProposalStatusSchema,
    actionRequest: designerActionRequestSchema.nullable(),
  })
  .strict();

const designerRuntimeConversationTranscriptSchema = z
  .object({
    providerConversationId: z.string().min(1),
    name: z.string().nullable(),
    preview: z.string().nullable(),
    turns: z.array(designerRuntimeConversationTranscriptTurnSchema),
    actionProposals: z.array(designerActionProposalSchema),
    userInputRequests: z.array(designerUserInputRequestSchema),
  })
  .strict();

export const createDesignerSessionResponseSchema = designerSessionSchema;

export const listDesignerSessionsResponseSchema = z
  .object({
    items: z.array(designerSessionSchema),
  })
  .strict();

export const getDesignerSessionResponseSchema = designerSessionSchema;
export const putDesignerSessionCanvasTabsResponseSchema = designerSessionSchema;
export const bootstrapDesignerRuntimeConversationResponseSchema = z
  .object({
    runtimeConversation: designerRuntimeConversationSchema,
  })
  .strict();
export const submitDesignerRuntimeFollowUpResponseSchema = z
  .object({
    runtimeFollowUp: designerRuntimeFollowUpSubmissionSchema,
  })
  .strict();
export const submitDesignerActionProposalResponseResponseSchema = z
  .object({
    actionProposalResponse: designerActionProposalResponseSubmissionSchema,
    actionRequest: designerActionRequestSchema,
  })
  .strict();
export const submitDesignerUserInputRequestResponseResponseSchema = z
  .object({
    userInputRequestResponse: z
      .object({
        requestId: designerUserInputRequestIdSchema,
        providerConversationId: z.string().min(1),
        submittedAt: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export const getDesignerRuntimeConversationTranscriptResponseSchema = z
  .object({
    runtimeConversationTranscript: designerRuntimeConversationTranscriptSchema,
  })
  .strict();

export type DesignerSessionResponse = z.infer<typeof designerSessionSchema>;
export type DesignerActionProposal = z.infer<typeof designerActionProposalSchema>;
export type DesignerProviderActionProposal = z.infer<typeof designerProviderActionProposalSchema>;
export type DesignerActionRequestState = z.infer<typeof designerActionRequestSchema>;
export type DesignerActionProposalResponse = z.infer<typeof designerActionProposalResponseSchema>;
export type DesignerUserInputRequest = z.infer<typeof designerUserInputRequestSchema>;
export type CreateDesignerSessionBody = z.infer<typeof createDesignerSessionBodySchema>;
export type PutDesignerSessionCanvasTabsBody = z.infer<
  typeof putDesignerSessionCanvasTabsBodySchema
>;
export type SubmitDesignerRuntimeFollowUpBody = z.infer<
  typeof submitDesignerRuntimeFollowUpBodySchema
>;
export type SubmitDesignerActionProposalResponseBody = z.infer<
  typeof submitDesignerActionProposalResponseBodySchema
>;
export type SubmitDesignerUserInputRequestResponseBody = z.infer<
  typeof submitDesignerUserInputRequestResponseBodySchema
>;
export type BootstrapDesignerRuntimeConversationResponse = z.infer<
  typeof bootstrapDesignerRuntimeConversationResponseSchema
>;
export type SubmitDesignerRuntimeFollowUpResponse = z.infer<
  typeof submitDesignerRuntimeFollowUpResponseSchema
>;
export type SubmitDesignerActionProposalResponseResponse = z.infer<
  typeof submitDesignerActionProposalResponseResponseSchema
>;
export type SubmitDesignerUserInputRequestResponseResponse = z.infer<
  typeof submitDesignerUserInputRequestResponseResponseSchema
>;
export type GetDesignerRuntimeConversationTranscriptResponse = z.infer<
  typeof getDesignerRuntimeConversationTranscriptResponseSchema
>;
