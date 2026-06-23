import { z } from "zod";

export const GoogleBusinessProfileTargetConfigSchema = z.object({}).strict();

export type GoogleBusinessProfileTargetConfig = z.output<
  typeof GoogleBusinessProfileTargetConfigSchema
>;
