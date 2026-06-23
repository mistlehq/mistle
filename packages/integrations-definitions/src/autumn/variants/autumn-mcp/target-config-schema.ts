import { z } from "zod";

export const AutumnTargetConfigSchema = z.object({}).strict();

export type AutumnTargetConfig = z.output<typeof AutumnTargetConfigSchema>;
