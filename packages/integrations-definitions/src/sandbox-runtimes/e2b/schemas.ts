import { z } from "zod";

export const E2BSandboxRuntimeTargetConfigSchema = z
  .object({
    domain: z.string().trim().min(1).default("e2b.app"),
  })
  .strict();

export const E2BSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const E2BSandboxRuntimeConnectionConfigSchema = z.object({}).strict();

export const E2BSandboxRuntimeBindingConfigSchema = z.object({}).strict();

export type E2BSandboxRuntimeConnectionConfig = z.output<
  typeof E2BSandboxRuntimeConnectionConfigSchema
>;
