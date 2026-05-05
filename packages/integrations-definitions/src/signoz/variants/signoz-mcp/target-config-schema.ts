import { z } from "zod";

export const SignozTargetConfigSchema = z
  .object({
    issuer_base_url: z.url().optional(),
  })
  .strict();

export type SignozTargetConfig = z.output<typeof SignozTargetConfigSchema>;
