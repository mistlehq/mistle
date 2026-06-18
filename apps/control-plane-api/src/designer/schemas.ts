import { z } from "@hono/zod-openapi";
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

export const designerSandboxInstanceIdParamsSchema = z
  .object({
    instanceId: z
      .string()
      .min(1)
      .regex(/^sbi_[a-zA-Z0-9_-]+$/, {
        message: "`instanceId` must be a sandbox instance id.",
      }),
  })
  .strict();

export const createDesignerSessionBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(255),
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

export const designerSessionSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
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

export const createDesignerSessionResponseSchema = designerSessionSchema;

export const listDesignerSessionsResponseSchema = z
  .object({
    items: z.array(designerSessionSchema),
  })
  .strict();

export const getDesignerSessionResponseSchema = designerSessionSchema;
export const putDesignerSessionCanvasTabsResponseSchema = designerSessionSchema;

export type DesignerSessionResponse = z.infer<typeof designerSessionSchema>;
export type CreateDesignerSessionBody = z.infer<typeof createDesignerSessionBodySchema>;
export type PutDesignerSessionCanvasTabsBody = z.infer<
  typeof putDesignerSessionCanvasTabsBodySchema
>;
