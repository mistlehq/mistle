import { z } from "zod";

export const GoogleAnalyticsTargetConfigSchema = z.object({}).strict();

export type GoogleAnalyticsTargetConfig = z.output<typeof GoogleAnalyticsTargetConfigSchema>;
