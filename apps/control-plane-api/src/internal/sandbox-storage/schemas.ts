import { z } from "@hono/zod-openapi";
import { SandboxStorageBackends, SandboxStorageConfigSources } from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { OrganizationSandboxStorageConfigV1Schema } from "../../sandbox-storage/storage-config.js";

export const ResolveSandboxStoragePersistenceModeRequestSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export const ResolveSandboxStoragePersistenceModeResponseSchema = z
  .object({
    persistentSandboxesEnabled: z.boolean(),
  })
  .strict();

export const ResolveSandboxStorageConfigurationRequestSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export const ResolveSandboxStorageConfigurationResponseSchema = z.union([
  z
    .object({
      persistentSandboxesEnabled: z.literal(false),
      storageConfigSource: z.literal(SandboxStorageConfigSources.MANAGED),
      storageBackend: z.null(),
      organizationStorageConfig: z.null(),
    })
    .strict(),
  z
    .object({
      persistentSandboxesEnabled: z.literal(false),
      storageConfigSource: z.literal(SandboxStorageConfigSources.ORGANIZATION),
      storageBackend: z.literal(SandboxStorageBackends.ARCHIL),
      organizationStorageConfig: OrganizationSandboxStorageConfigV1Schema,
    })
    .strict(),
  z
    .object({
      persistentSandboxesEnabled: z.literal(true),
      storageConfigSource: z.literal(SandboxStorageConfigSources.MANAGED),
      storageBackend: z.null(),
      organizationStorageConfig: z.null(),
    })
    .strict(),
  z
    .object({
      persistentSandboxesEnabled: z.literal(true),
      storageConfigSource: z.literal(SandboxStorageConfigSources.ORGANIZATION),
      storageBackend: z.literal(SandboxStorageBackends.ARCHIL),
      organizationStorageConfig: OrganizationSandboxStorageConfigV1Schema,
    })
    .strict(),
]);

export const SandboxStorageCredentialKindSchema = z.literal("disk_token");

export const EncryptSandboxStorageCredentialRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    credentialKind: SandboxStorageCredentialKindSchema,
    plaintext: z.string().min(1),
  })
  .strict();

export const EncryptSandboxStorageCredentialResponseSchema = z
  .object({
    credentialKind: SandboxStorageCredentialKindSchema,
    ciphertext: z.string().min(1),
    nonce: z.string().min(1),
    organizationCredentialKeyVersion: z.number().int().min(1),
  })
  .strict();

export const ResolveSandboxStorageCredentialRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    credentialKind: SandboxStorageCredentialKindSchema,
    ciphertext: z.string().min(1),
    nonce: z.string().min(1),
    organizationCredentialKeyVersion: z.number().int().min(1),
  })
  .strict();

export const ResolveSandboxStorageCredentialResponseSchema = z
  .object({
    credentialKind: SandboxStorageCredentialKindSchema,
    plaintext: z.string().min(1),
  })
  .strict();

export const InternalSandboxStorageBadRequestResponseSchema = ValidationErrorResponseSchema;
