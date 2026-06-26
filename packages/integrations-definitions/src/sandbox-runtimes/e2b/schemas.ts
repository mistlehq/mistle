import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

import { E2BToolIds } from "./constants.js";

export const E2BSandboxRuntimeTargetConfigSchema = z
  .object({
    domain: z.string().trim().min(1).default("e2b.app"),
  })
  .strict();

export const E2BSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const E2BSandboxRuntimeConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

const E2BToolSchema = z.enum([E2BToolIds.E2B_CLI]);

export const E2BSandboxRuntimeBindingConfigSchema = z
  .object({
    tools: z.array(E2BToolSchema).default([]),
  })
  .strict();

export type E2BSandboxRuntimeConnectionConfig = z.output<
  typeof E2BSandboxRuntimeConnectionConfigSchema
>;

export type E2BSandboxRuntimeBindingConfig = z.output<typeof E2BSandboxRuntimeBindingConfigSchema>;

export type E2BSandboxRuntimeTargetConfig = z.output<typeof E2BSandboxRuntimeTargetConfigSchema>;
