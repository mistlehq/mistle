import { z } from "zod";

export const TensorlakeSandboxRuntimeTargetConfigSchema = z.object({}).strict();

export const TensorlakeSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const TensorlakeSandboxRuntimeConnectionConfigSchema = z.object({}).strict();

export const TensorlakeSandboxRuntimeBindingConfigSchema = z.object({}).strict();

export type TensorlakeSandboxRuntimeConnectionConfig = z.output<
  typeof TensorlakeSandboxRuntimeConnectionConfigSchema
>;
