import { z } from "zod";

export const ModalSandboxRuntimeTargetConfigSchema = z.object({}).strict();

export const ModalSandboxRuntimeTargetSecretSchema = z.object({}).strict();

export const ModalSandboxRuntimeBindingConfigSchema = z.object({}).strict();

export type ModalSandboxRuntimeConnectionConfig = Record<string, never>;
