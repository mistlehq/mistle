import { z } from "zod";

export const GoogleTargetConfigSchema = z.object({}).strict();

export type GoogleTargetConfig = z.output<typeof GoogleTargetConfigSchema>;
