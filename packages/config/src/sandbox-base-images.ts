import { readFileSync } from "node:fs";

import { z } from "zod";

const LocalSandboxBaseImageRefsSchema = z
  .object({
    localDev: z
      .object({
        dockerRegistry: z.string().min(1),
        preparedRuntime: z.string().min(1),
      })
      .strict(),
    localTest: z
      .object({
        docker: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const PublishedSandboxBaseImageRefSchema = z
  .string()
  .regex(/^ghcr\.io\/mistlehq\/sandbox-base@sha256:[a-f0-9]{64}$/);

export type LocalSandboxBaseImageRefs = z.infer<typeof LocalSandboxBaseImageRefsSchema>;
export type PublishedSandboxBaseImageRef = z.infer<typeof PublishedSandboxBaseImageRefSchema>;

export type PublishedSandboxBaseImageRefResolver = {
  resolveLatestPublishedSandboxBaseImageRef(): Promise<string>;
};

function createLocalSandboxBaseImagesManifestUrl(fromImportMetaUrl: string): URL {
  return new URL("../../../config/sandbox-base-images.json", fromImportMetaUrl);
}

export function parseLocalSandboxBaseImageRefs(value: unknown): LocalSandboxBaseImageRefs {
  return LocalSandboxBaseImageRefsSchema.parse(value);
}

export function parsePublishedSandboxBaseImageRef(value: unknown): PublishedSandboxBaseImageRef {
  return PublishedSandboxBaseImageRefSchema.parse(value);
}

export function readLocalSandboxBaseImageRefs(
  fromImportMetaUrl: string = import.meta.url,
): LocalSandboxBaseImageRefs {
  const manifestUrl = createLocalSandboxBaseImagesManifestUrl(fromImportMetaUrl);
  const manifestText = readFileSync(manifestUrl, "utf8");
  const rawManifest: unknown = JSON.parse(manifestText);

  return parseLocalSandboxBaseImageRefs(rawManifest);
}

export function getLocalDevDockerRegistrySandboxBaseImageRef(fromImportMetaUrl?: string): string {
  return readLocalSandboxBaseImageRefs(fromImportMetaUrl).localDev.dockerRegistry;
}

export function getLocalPreparedRuntimeSandboxBaseImageRef(fromImportMetaUrl?: string): string {
  return readLocalSandboxBaseImageRefs(fromImportMetaUrl).localDev.preparedRuntime;
}

export function getLocalTestSandboxBaseImageRef(fromImportMetaUrl?: string): string {
  return readLocalSandboxBaseImageRefs(fromImportMetaUrl).localTest.docker;
}
