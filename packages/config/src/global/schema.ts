import { z } from "zod";

export const GlobalTunnelConfigSchema = z
  .object({
    bootstrapTokenSecret: z.string().trim().min(1),
    tokenIssuer: z.string().trim().min(1),
    tokenAudience: z.string().trim().min(1),
  })
  .strict();

export const GlobalConfigSchema = z
  .object({
    env: z.enum(["development", "production"]),
    internalAuth: z
      .object({
        serviceToken: z.string().trim().min(1),
      })
      .strict(),
    tunnel: GlobalTunnelConfigSchema,
  })
  .strict();

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type GlobalConfigInput = z.input<typeof GlobalConfigSchema>;
export type PartialGlobalConfigInput = {
  [Key in keyof GlobalConfigInput]?: GlobalConfigInput[Key] | undefined;
};
