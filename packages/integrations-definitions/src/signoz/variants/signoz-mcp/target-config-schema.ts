import { z } from "zod";

export const SignozTargetConfigSchema = z.object({}).strict();

export type SignozTargetConfig = z.output<typeof SignozTargetConfigSchema>;
