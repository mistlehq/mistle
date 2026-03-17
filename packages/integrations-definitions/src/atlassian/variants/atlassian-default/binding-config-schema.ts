import { z } from "zod";

export const AtlassianBindingConfigSchema = z.object({}).strict();

export type AtlassianBindingConfig = z.output<typeof AtlassianBindingConfigSchema>;
