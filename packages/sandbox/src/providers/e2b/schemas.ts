import { z } from "zod";

export const E2BSandboxConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, {
      message: "E2B config field `apiKey` is required.",
    }),
    domain: z.string().trim().min(1).optional(),
  })
  .strict();

export type E2BSandboxConfig = z.output<typeof E2BSandboxConfigSchema>;
