import { z } from "@hono/zod-openapi";
import { DesignerActionRequestStatuses } from "@mistle/db/control-plane";
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

const designerActionRequestSchema = z
  .object({
    id: z.string().min(1),
    status: designerActionRequestStatusSchema,
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

const designerRuntimeConversationTranscriptTurnSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1).nullable(),
    items: z.array(z.unknown()),
  })
  .strict();

const designerActionProposalDetailSchema = z
  .object({
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(2_000),
  })
  .strict();

export const designerActionProposalSchema = z
  .object({
    id: z.string().min(1).max(255),
    kind: z.literal("designerActionProposal"),
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(2_000),
    status: z.enum(["pending", "approved", "declined"]),
    operation: z
      .object({
        kind: z.literal("providerConfigurationChange"),
        provider: z.string().min(1).max(120),
        resourceType: z.string().min(1).max(120),
        resourceLabel: z.string().min(1).max(240).nullable(),
        action: z.string().min(1).max(160),
        details: z.array(designerActionProposalDetailSchema).max(20),
      })
      .strict(),
  })
  .strict();

const designerRuntimeConversationTranscriptSchema = z
  .object({
    providerConversationId: z.string().min(1),
    name: z.string().nullable(),
    preview: z.string().nullable(),
    turns: z.array(designerRuntimeConversationTranscriptTurnSchema),
    actionProposals: z.array(designerActionProposalSchema),
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
export const getDesignerRuntimeConversationTranscriptResponseSchema = z
  .object({
    runtimeConversationTranscript: designerRuntimeConversationTranscriptSchema,
  })
  .strict();

export type DesignerSessionResponse = z.infer<typeof designerSessionSchema>;
export type DesignerActionProposal = z.infer<typeof designerActionProposalSchema>;
export type DesignerActionProposalResponse = z.infer<typeof designerActionProposalResponseSchema>;
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
export type BootstrapDesignerRuntimeConversationResponse = z.infer<
  typeof bootstrapDesignerRuntimeConversationResponseSchema
>;
export type SubmitDesignerRuntimeFollowUpResponse = z.infer<
  typeof submitDesignerRuntimeFollowUpResponseSchema
>;
export type SubmitDesignerActionProposalResponseResponse = z.infer<
  typeof submitDesignerActionProposalResponseResponseSchema
>;
export type GetDesignerRuntimeConversationTranscriptResponse = z.infer<
  typeof getDesignerRuntimeConversationTranscriptResponseSchema
>;
