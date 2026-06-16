import { z } from "zod";

import { StripeToolIds } from "./tool-ids.js";

export const StripeBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([StripeToolIds.STRIPE_MCP])).default([StripeToolIds.STRIPE_MCP]),
  })
  .strict();

export type StripeBindingConfig = z.output<typeof StripeBindingConfigSchema>;
