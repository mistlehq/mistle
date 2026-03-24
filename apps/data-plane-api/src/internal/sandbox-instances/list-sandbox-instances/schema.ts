import { z } from "@hono/zod-openapi";

export const ListSandboxInstancesInputSchema = z
  .object({
    organizationId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.after !== undefined && value.before !== undefined), {
    message: "Only one of `after` or `before` can be provided.",
  });

export type ListSandboxInstancesInput = z.infer<typeof ListSandboxInstancesInputSchema>;
