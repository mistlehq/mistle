import { z } from "@hono/zod-openapi";

const SandboxRuntimeResourceFieldSchema = z
  .object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
    step: z.number().int().min(1),
    default: z.number().int().min(0),
  })
  .strict();

const SandboxRuntimeMemoryResourceFieldSchema = SandboxRuntimeResourceFieldSchema.extend({
  minPerVcpu: z.number().int().min(0).optional(),
  maxPerVcpu: z.number().int().min(0).optional(),
}).strict();

export const SandboxRuntimeResourceCapabilitiesSchema = z
  .object({
    vcpuCount: SandboxRuntimeResourceFieldSchema,
    memoryMb: SandboxRuntimeMemoryResourceFieldSchema,
    storageMb: SandboxRuntimeResourceFieldSchema.optional(),
  })
  .strict();

export const SandboxProviderSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    managed: z.boolean(),
    supportsOrganizationConnection: z.boolean(),
    resourceCapabilities: SandboxRuntimeResourceCapabilitiesSchema.nullable(),
  })
  .strict();

export const ListSandboxProvidersResponseSchema = z
  .object({
    items: z.array(SandboxProviderSchema),
  })
  .strict();

export type ListSandboxProvidersResponse = z.infer<typeof ListSandboxProvidersResponseSchema>;
