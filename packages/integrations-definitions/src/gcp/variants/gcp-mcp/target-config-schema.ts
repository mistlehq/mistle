import { z } from "zod";

export const GcpTargetConfigSchema = z.object({}).strict();

export type GcpTargetConfig = z.output<typeof GcpTargetConfigSchema>;
