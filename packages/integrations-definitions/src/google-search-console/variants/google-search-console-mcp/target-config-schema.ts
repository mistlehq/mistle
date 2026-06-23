import { z } from "zod";

export const GoogleSearchConsoleTargetConfigSchema = z.object({}).strict();

export type GoogleSearchConsoleTargetConfig = z.output<
  typeof GoogleSearchConsoleTargetConfigSchema
>;
