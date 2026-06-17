import { z } from "zod";

import { TensorlakeToolIds } from "./constants.js";

export const TensorlakeSandboxRuntimeTargetConfigSchema = z.object({}).strict();

export const TensorlakeSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const TensorlakeSandboxRuntimeConnectionConfigSchema = z.object({}).strict();

const TensorlakeToolSchema = z.enum([TensorlakeToolIds.TENSORLAKE_CLI]);

export const TensorlakeSandboxRuntimeBindingConfigSchema = z
  .object({
    tools: z.array(TensorlakeToolSchema).default([]),
  })
  .strict();

export type TensorlakeSandboxRuntimeConnectionConfig = z.output<
  typeof TensorlakeSandboxRuntimeConnectionConfigSchema
>;

export type TensorlakeSandboxRuntimeBindingConfig = z.output<
  typeof TensorlakeSandboxRuntimeBindingConfigSchema
>;
