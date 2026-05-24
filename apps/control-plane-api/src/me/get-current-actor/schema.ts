import { z } from "@hono/zod-openapi";

import { ApiKeyPermissionSchema } from "../../api-keys/schemas.js";

export const CurrentActorResponseSchema = z
  .object({
    authentication: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("session"),
        })
        .strict(),
      z
        .object({
          kind: z.literal("api_key"),
          apiKey: z
            .object({
              id: z.string().min(1),
              name: z.string().min(1),
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("oauth"),
        })
        .strict(),
    ]),
    actor: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("user"),
          id: z.string().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("api_key"),
          id: z.string().min(1),
          name: z.string().min(1),
        })
        .strict(),
    ]),
    organization: z
      .object({
        id: z.string().min(1),
      })
      .strict(),
    permissions: z.array(ApiKeyPermissionSchema),
  })
  .strict();
