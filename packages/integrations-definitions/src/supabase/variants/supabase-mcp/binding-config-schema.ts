import { z } from "zod";

import { SupabaseToolIds } from "./tool-ids.js";

export const SupabaseBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([SupabaseToolIds.SUPABASE_MCP])).default([SupabaseToolIds.SUPABASE_MCP]),
  })
  .strict();

export type SupabaseBindingConfig = z.output<typeof SupabaseBindingConfigSchema>;
