import { z } from "zod";

export const ControlPlaneApiConfigSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

export type ControlPlaneApiConfig = z.infer<typeof ControlPlaneApiConfigSchema>;
export type ControlPlaneApiConfigInput = z.input<typeof ControlPlaneApiConfigSchema>;
export type PartialControlPlaneApiConfigInput = {
  [Key in keyof ControlPlaneApiConfigInput]?: ControlPlaneApiConfigInput[Key] | undefined;
};
