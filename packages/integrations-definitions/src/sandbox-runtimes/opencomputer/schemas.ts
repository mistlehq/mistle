import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

import { OpenComputerToolIds } from "./constants.js";

export const OpenComputerSandboxRuntimeTargetConfigSchema = z
  .object({
    apiBaseUrl: z.url().optional(),
  })
  .strict();

export const OpenComputerSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const OpenComputerSandboxRuntimeConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export const OpenComputerSandboxRuntimeBindingConfigSchema = z
  .object({
    tools: z.array(z.enum([OpenComputerToolIds.OPENCOMPUTER_CLI])).default([]),
  })
  .strict();

export type OpenComputerSandboxRuntimeConnectionConfig = z.output<
  typeof OpenComputerSandboxRuntimeConnectionConfigSchema
>;

export type OpenComputerSandboxRuntimeTargetConfig = z.output<
  typeof OpenComputerSandboxRuntimeTargetConfigSchema
>;

export type OpenComputerSandboxRuntimeBindingConfig = z.output<
  typeof OpenComputerSandboxRuntimeBindingConfigSchema
>;
