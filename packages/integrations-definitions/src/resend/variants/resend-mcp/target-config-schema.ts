import { z } from "zod";

export const ResendApiBaseUrl = "https://api.resend.com";

export const ResendTargetConfigSchema = z.object({}).strict();

export type ResendTargetConfig = z.output<typeof ResendTargetConfigSchema>;
