import { z } from "zod";

import { ResendToolIds } from "./tool-ids.js";

const ResendToolSchema = z.enum([ResendToolIds.RESEND_MCP]);

export const ResendBindingConfigSchema = z
  .object({
    tools: z.array(ResendToolSchema).default([ResendToolIds.RESEND_MCP]),
    senderEmailAddress: z.string().trim().pipe(z.email()).optional(),
    replyToEmailAddresses: z.array(z.email()).default([]),
  })
  .strict();

export type ResendBindingConfig = z.output<typeof ResendBindingConfigSchema>;
