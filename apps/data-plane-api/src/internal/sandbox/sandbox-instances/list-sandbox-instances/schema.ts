import { z } from "@hono/zod-openapi";
import { createKeysetPageSizeSchema } from "@mistle/http/pagination";

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
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.after !== undefined && value.before !== undefined), {
    message: "Only one of `after` or `before` can be provided.",
  });
