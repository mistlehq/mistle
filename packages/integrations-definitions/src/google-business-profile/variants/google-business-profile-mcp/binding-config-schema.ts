import { z } from "zod";

import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

const GoogleBusinessProfileToolSchema = z.enum([
  GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI,
  GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
]);

export const GoogleBusinessProfileBindingConfigSchema = z
  .object({
    tools: z.array(GoogleBusinessProfileToolSchema).default([]),
  })
  .strict();

export type GoogleBusinessProfileBindingConfig = z.output<
  typeof GoogleBusinessProfileBindingConfigSchema
>;
