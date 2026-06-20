import { z } from "@hono/zod-openapi";

export const GetSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    allowedPurposes: z
      .string()
      .min(1)
      .transform((value) => value.split(","))
      .pipe(
        z
          .array(
            z.enum(["session", "designer", "setup_assistant", "setup_check", "skills_discovery"]),
          )
          .min(1),
      )
      .optional(),
  })
  .strict();
