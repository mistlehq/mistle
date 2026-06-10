import { z } from "zod";

export const FreestyleSandboxRuntimeTargetConfigSchema = z
  .object({
    baseUrl: z.url().optional(),
  })
  .strict();

export const FreestyleSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const FreestyleSandboxRuntimeConnectionConfigSchema = z.object({}).strict();

export const FreestyleSandboxRuntimeBindingConfigSchema = z.object({}).strict();

export type FreestyleSandboxRuntimeConnectionConfig = z.output<
  typeof FreestyleSandboxRuntimeConnectionConfigSchema
>;
