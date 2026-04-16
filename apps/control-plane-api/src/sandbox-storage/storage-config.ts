import { z } from "@hono/zod-openapi";

export const OrganizationSandboxStorageConfigVersion = 1;

export const OrganizationSandboxStorageMountSchema = z
  .object({
    type: z.literal("s3-compatible"),
    bucket: z.string().min(1),
    endpoint: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
  })
  .strict();

export const OrganizationSandboxStorageMountsSchema = z.union([
  z.tuple([]),
  z.tuple([OrganizationSandboxStorageMountSchema]),
]);

export const OrganizationSandboxStorageConfigV1Schema = z
  .object({
    backend: z.literal("archil"),
    apiKey: z.string().min(1),
    region: z.string().min(1),
    namePrefix: z.string().min(1).optional(),
    mounts: OrganizationSandboxStorageMountsSchema.optional(),
  })
  .strict();

export type OrganizationSandboxStorageConfigV1 = z.infer<
  typeof OrganizationSandboxStorageConfigV1Schema
>;

export const OrganizationSandboxStorageConfigSummarySchema = z
  .object({
    backend: z.literal("archil"),
    region: z.string().min(1),
    namePrefix: z.string().min(1).nullable(),
    apiKeyConfigured: z.boolean(),
    mounts: z.union([
      z.tuple([]),
      z.tuple([
        z
          .object({
            type: z.literal("s3-compatible"),
            bucket: z.string().min(1),
            endpoint: z.string().min(1),
            accessKeyId: z.string().min(1),
            secretAccessKeyConfigured: z.boolean(),
          })
          .strict(),
      ]),
    ]),
  })
  .strict();

export type OrganizationSandboxStorageConfigSummary = z.infer<
  typeof OrganizationSandboxStorageConfigSummarySchema
>;

export function summarizeOrganizationSandboxStorageConfig(
  input: OrganizationSandboxStorageConfigV1,
): OrganizationSandboxStorageConfigSummary {
  const mounts: OrganizationSandboxStorageConfigSummary["mounts"] =
    input.mounts === undefined || input.mounts.length === 0
      ? []
      : [
          {
            type: input.mounts[0].type,
            bucket: input.mounts[0].bucket,
            endpoint: input.mounts[0].endpoint,
            accessKeyId: input.mounts[0].accessKeyId,
            secretAccessKeyConfigured: input.mounts[0].secretAccessKey.length > 0,
          },
        ];

  return {
    backend: input.backend,
    region: input.region,
    namePrefix: input.namePrefix ?? null,
    apiKeyConfigured: input.apiKey.length > 0,
    mounts,
  };
}
