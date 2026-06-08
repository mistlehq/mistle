import { z } from "zod";

export const CloudflareTargetConfigSchema = z.object({}).strict();

export type CloudflareTargetConfig = z.output<typeof CloudflareTargetConfigSchema>;
