import { z } from "@hono/zod-openapi";

export const ListSandboxInstancesInputSchema = z
  .object({
    organizationId: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    startedByKind: z.enum(["user", "system"]).optional(),
    startedById: z.string().min(1).optional(),
    startedByScope: z.enum(["self", "others"]).optional(),
    startedByUserId: z.string().min(1).optional(),
    source: z.enum(["dashboard", "trigger", "webhook", "schedule"]).optional(),
    titleSearch: z.string().trim().min(1).max(200).optional(),
    matchingSandboxProfileIds: z.array(z.string().min(1)).min(1).optional(),
    matchingStartedByUserIds: z.array(z.string().min(1)).min(1).optional(),
    matchingStartedBySystemIds: z.array(z.string().min(1)).min(1).optional(),
    startedBySystemIds: z.array(z.string().min(1)).min(1).optional(),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.after !== undefined && value.before !== undefined), {
    message: "Only one of `after` or `before` can be provided.",
  })
  .refine(
    (value) =>
      (value.startedByKind === undefined && value.startedById === undefined) ||
      (value.startedByKind !== undefined && value.startedById !== undefined),
    {
      message: "`startedByKind` and `startedById` must be provided together.",
    },
  )
  .refine(
    (value) =>
      (value.startedByScope === undefined && value.startedByUserId === undefined) ||
      (value.startedByScope !== undefined && value.startedByUserId !== undefined),
    {
      message: "`startedByScope` and `startedByUserId` must be provided together.",
    },
  );

export type ListSandboxInstancesInput = z.infer<typeof ListSandboxInstancesInputSchema>;
