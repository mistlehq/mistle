import { z } from "@hono/zod-openapi";
import { SandboxProvider } from "@mistle/sandbox";

const SandboxImageProviderSchema = z.enum(SandboxProvider);

export const PruneUnusedSandboxImagesRequestSchema = z
  .object({
    cutoff: z.string().min(1),
    targets: z.array(
      z
        .object({
          organizationId: z.string().min(1),
          provider: SandboxImageProviderSchema,
          connectionId: z.string().min(1).optional(),
          referencedImages: z.array(
            z
              .object({
                provider: SandboxImageProviderSchema,
                imageId: z.string().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    idempotencyKey: z.string().min(1),
  })
  .strict();

export const PruneUnusedSandboxImagesAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type PruneUnusedSandboxImagesRequest = z.infer<typeof PruneUnusedSandboxImagesRequestSchema>;
export type PruneUnusedSandboxImagesAcceptedResponse = z.infer<
  typeof PruneUnusedSandboxImagesAcceptedResponseSchema
>;
