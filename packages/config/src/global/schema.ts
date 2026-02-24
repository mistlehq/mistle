import { z } from "zod";

export const GlobalConfigSchema = z
  .object({
    env: z.enum(["development", "production"]),
  })
  .strict();

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type GlobalConfigInput = z.input<typeof GlobalConfigSchema>;
export type PartialGlobalConfigInput = {
  [Key in keyof GlobalConfigInput]?: GlobalConfigInput[Key] | undefined;
};
