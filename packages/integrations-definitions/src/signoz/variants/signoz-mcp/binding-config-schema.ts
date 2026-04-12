import { z } from "zod";

import { SignozToolIds } from "./tool-ids.js";

const SignozToolSchema = z.enum([SignozToolIds.SIGNOZ_MCP]);

export const SignozBindingConfigSchema = z
  .object({
    tools: z.array(SignozToolSchema).default([]),
  })
  .strict();

export type SignozBindingConfig = z.output<typeof SignozBindingConfigSchema>;
