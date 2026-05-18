import { z } from "@hono/zod-openapi";
import { createKeysetPageSizeSchema } from "@mistle/http/pagination";

function parseCommaSeparatedValues(rawValue: unknown): unknown {
  if (typeof rawValue !== "string") {
    return rawValue;
  }

  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export const ListSandboxInstancesQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    limit: z.preprocess(
      (rawValue) => {
        if (rawValue === undefined) {
          return undefined;
        }

        if (typeof rawValue === "number") {
          return rawValue;
        }

        if (typeof rawValue === "string") {
          return Number(rawValue);
        }

        return rawValue;
      },
      createKeysetPageSizeSchema({ defaultLimit: 20, maxLimit: 100 }),
    ),
    startedByKind: z.enum(["user", "api_key", "system"]).optional(),
    startedById: z.string().min(1).optional(),
    startedByScope: z.enum(["self", "others"]).optional(),
    startedByUserId: z.string().min(1).optional(),
    source: z.enum(["dashboard", "trigger", "webhook", "schedule"]).optional(),
    titleSearch: z.string().trim().min(1).max(200).optional(),
    matchingSandboxProfileIds: z
      .preprocess(parseCommaSeparatedValues, z.array(z.string().min(1)).min(1).max(500))
      .optional(),
    matchingStartedByUserIds: z
      .preprocess(parseCommaSeparatedValues, z.array(z.string().min(1)).min(1).max(500))
      .optional(),
    matchingStartedBySystemIds: z
      .preprocess(parseCommaSeparatedValues, z.array(z.string().min(1)).min(1).max(500))
      .optional(),
    startedBySystemIds: z
      .preprocess(parseCommaSeparatedValues, z.array(z.string().min(1)).min(1).max(500))
      .optional(),
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
