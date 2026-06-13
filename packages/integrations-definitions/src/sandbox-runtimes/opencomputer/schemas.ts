import { z } from "zod";

export const OpenComputerSandboxRuntimeTargetConfigSchema = z
  .object({
    apiBaseUrl: z.url().optional(),
  })
  .strict();

export const OpenComputerSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const OpenComputerSandboxRuntimeConnectionConfigSchema = z.object({}).strict();

export const OpenComputerSandboxRuntimeBindingConfigSchema = z.object({}).strict();

export type OpenComputerSandboxRuntimeConnectionConfig = z.output<
  typeof OpenComputerSandboxRuntimeConnectionConfigSchema
>;
