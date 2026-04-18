import { z } from "@hono/zod-openapi";

import { RedirectLocationHeaderSchema } from "../../integration-connections/schemas.js";

export const CompleteLinkedAccountCallbackParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const CompleteLinkedAccountCallbackQuerySchema = z
  .object({
    state: z.string().min(1).optional(),
  })
  .catchall(z.string());

export { RedirectLocationHeaderSchema };
