import { z } from "zod";

const PositiveIntegerSchema = z.number().int().positive();

export const SandboxKeepaliveStateSchema = z
  .object({
    type: z.literal("keepalive.state"),
    ttlMs: PositiveIntegerSchema,
    active: z.boolean(),
  })
  .strict();

export type SandboxKeepaliveState = z.infer<typeof SandboxKeepaliveStateSchema>;
