import { z } from "@hono/zod-openapi";
import { createKeysetPageSizeSchema } from "@mistle/http/pagination";

export const ListRecentSandboxInstancesQuerySchema = z
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
      createKeysetPageSizeSchema({ defaultLimit: 100, maxLimit: 100 }),
    ),
  })
  .strict();
