import { z } from "zod";

export const PiRuntimeConfigSchema = z
  .object({
    enableMcp: z.boolean().default(true),
  })
  .strict();

export type PiRuntimeConfig = z.output<typeof PiRuntimeConfigSchema>;
