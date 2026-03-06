import { z } from "zod";

export const LinearTargetConfigSchema = z.object({}).strict();

export type LinearTargetConfig = z.output<typeof LinearTargetConfigSchema>;
