import { z } from "zod";

export const AtlassianTargetConfigSchema = z.object({}).strict();

export type AtlassianTargetConfig = z.output<typeof AtlassianTargetConfigSchema>;
