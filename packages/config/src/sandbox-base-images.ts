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

const SandboxBasePublishWorkflowRunsResponseSchema = z
  .object({
    workflow_runs: z
      .array(
        z
          .object({
            head_sha: z.string().regex(/^[a-f0-9]{40}$/),
          })
          .strip(),
      )
      .min(1, {
        message: "Expected at least one successful sandbox base publish workflow run.",
      }),
  })
  .strip();

const GhcrRegistryTokenResponseSchema = z
  .object({
    token: z.string().trim().min(1),
  })
  .strip();

const SandboxBasePublishWorkflowRunsUrl = new URL(
  "https://api.github.com/repos/mistlehq/mistle/actions/workflows/publish-sandbox-base.yml/runs?status=success&per_page=1",
);
const GhcrSandboxBasePullTokenUrl = new URL(
  "https://ghcr.io/token?scope=repository:mistlehq/sandbox-base:pull",
);
const GitHubApiVersion = "2022-11-28";
const ResolverUserAgent = "mistle-sandbox-base-image-resolver";

export type LocalSandboxBaseImageRefs = z.infer<typeof LocalSandboxBaseImageRefsSchema>;
export type PublishedSandboxBaseImageRef = z.infer<typeof PublishedSandboxBaseImageRefSchema>;

export type PublishedSandboxBaseImageRefResolver = {
  resolveLatestPublishedSandboxBaseImageRef(): Promise<PublishedSandboxBaseImageRef>;
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

function createGhcrSandboxBaseManifestUrl(tag: string): URL {
  return new URL(`https://ghcr.io/v2/mistlehq/sandbox-base/manifests/${encodeURIComponent(tag)}`);
}

async function fetchRequiredJson<T>(input: {
  url: URL;
  context: string;
  schema: z.ZodType<T>;
  headers?: HeadersInit;
}): Promise<T> {
  const requestInit: RequestInit = input.headers === undefined ? {} : { headers: input.headers };
  const response = await fetch(input.url, requestInit);

  if (!response.ok) {
    throw new Error(
      `Failed to ${input.context}. Received ${String(response.status)} ${response.statusText}.`,
    );
  }

  let rawPayload: unknown;

  try {
    rawPayload = await response.json();
  } catch (error) {
    throw new Error(
      `Failed to ${input.context}. Response body was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return input.schema.parse(rawPayload);
}

async function resolveLatestPublishedSandboxBaseImageTag(): Promise<string> {
  const payload = await fetchRequiredJson({
    url: SandboxBasePublishWorkflowRunsUrl,
    context: "read the latest successful sandbox base publish workflow run",
    schema: SandboxBasePublishWorkflowRunsResponseSchema,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": ResolverUserAgent,
      "x-github-api-version": GitHubApiVersion,
    },
  });
  const latestWorkflowRun = payload.workflow_runs[0];

  if (latestWorkflowRun === undefined) {
    throw new Error("Expected the latest successful sandbox base publish workflow run to exist.");
  }

  return latestWorkflowRun.head_sha;
}

async function resolveGhcrSandboxBasePullToken(): Promise<string> {
  const payload = await fetchRequiredJson({
    url: GhcrSandboxBasePullTokenUrl,
    context: "request an anonymous GHCR pull token for the sandbox base image",
    schema: GhcrRegistryTokenResponseSchema,
  });

  return payload.token;
}

async function resolvePublishedSandboxBaseImageDigestForTag(tag: string): Promise<string> {
  const ghcrPullToken = await resolveGhcrSandboxBasePullToken();
  const manifestUrl = createGhcrSandboxBaseManifestUrl(tag);
  const response = await fetch(manifestUrl, {
    method: "HEAD",
    headers: {
      accept: "application/vnd.docker.distribution.manifest.v2+json",
      authorization: `Bearer ${ghcrPullToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to resolve the GHCR manifest digest for sandbox base tag "${tag}". Received ${String(
        response.status,
      )} ${response.statusText}.`,
    );
  }

  const digest = response.headers.get("docker-content-digest");

  if (digest === null || digest.trim().length === 0) {
    throw new Error(`GHCR did not return a docker-content-digest header for tag "${tag}".`);
  }

  return digest;
}

export async function resolveLatestPublishedSandboxBaseImageRef(): Promise<PublishedSandboxBaseImageRef> {
  const latestPublishedTag = await resolveLatestPublishedSandboxBaseImageTag();
  const latestPublishedDigest =
    await resolvePublishedSandboxBaseImageDigestForTag(latestPublishedTag);

  return parsePublishedSandboxBaseImageRef(
    `ghcr.io/mistlehq/sandbox-base@${latestPublishedDigest}`,
  );
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
