import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const ModalSandboxRuntimeTargetConfigSchema = z.object({}).strict();

export const ModalSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const ModalSandboxRuntimeConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

export const ModalSandboxRuntimeBindingConfigSchema = z.object({}).strict();

export type ModalSandboxRuntimeConnectionConfig = z.output<
  typeof ModalSandboxRuntimeConnectionConfigSchema
>;
