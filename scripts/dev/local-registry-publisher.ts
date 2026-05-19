import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

type DockerSaveManifestEntry = {
  Config: string;
  Layers: string[];
  RepoTags?: string[];
};

type DockerRegistryDescriptor = {
  mediaType: string;
  digest: string;
  size: number;
};

type DockerRegistryManifest = {
  schemaVersion: 2;
  mediaType: string;
  config: DockerRegistryDescriptor;
  layers: DockerRegistryDescriptor[];
};

type DockerImageReferenceParts = {
  registryHost: string;
  repository: string;
  tag: string;
};

type PublishLocalDockerImageInput = {
  sourceImageRef: string;
  targetImageRef: string;
};

const DockerDistributionManifestMediaType = "application/vnd.docker.distribution.manifest.v2+json";
const DockerImageConfigMediaType = "application/vnd.docker.container.image.v1+json";
const DockerGzipLayerMediaType = "application/vnd.docker.image.rootfs.diff.tar.gzip";

export async function publishLocalDockerImageToHttpRegistry(
  input: PublishLocalDockerImageInput,
): Promise<void> {
  const target = parseDockerImageReference(input.targetImageRef);
  const workspacePath = await mkdtemp(join(tmpdir(), "mistle-local-registry-publish-"));

  try {
    const archivePath = join(workspacePath, "image.tar");
    runCommandOrThrow("docker", ["save", "--output", archivePath, input.sourceImageRef]);
    runCommandOrThrow("tar", ["-xf", archivePath, "-C", workspacePath]);

    const dockerSaveEntry = await readDockerSaveManifestEntry(workspacePath, input.sourceImageRef);
    const registryBaseUrl = new URL(`http://${target.registryHost}`);
    const configPath = join(workspacePath, dockerSaveEntry.Config);
    const configDescriptor = await createFileDescriptor(configPath, DockerImageConfigMediaType);
    const layerDescriptors = [];

    await uploadRegistryBlob({
      baseUrl: registryBaseUrl,
      repository: target.repository,
      descriptor: configDescriptor,
      filePath: configPath,
    });

    for (const layerPath of dockerSaveEntry.Layers) {
      const absoluteLayerPath = join(workspacePath, layerPath);
      const compressedLayerPath = join(workspacePath, `${basename(layerPath)}.gz`);
      await pipeline(
        createReadStream(absoluteLayerPath),
        createGzip(),
        createWriteStream(compressedLayerPath),
      );
      const layerDescriptor = await createFileDescriptor(
        compressedLayerPath,
        DockerGzipLayerMediaType,
      );
      await uploadRegistryBlob({
        baseUrl: registryBaseUrl,
        repository: target.repository,
        descriptor: layerDescriptor,
        filePath: compressedLayerPath,
      });
      layerDescriptors.push(layerDescriptor);
    }

    const manifest = createDockerRegistryManifest({
      config: configDescriptor,
      layers: layerDescriptors,
    });
    await putRegistryManifest({
      baseUrl: registryBaseUrl,
      repository: target.repository,
      tag: target.tag,
      manifest,
    });
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

export function parseDockerImageReference(imageRef: string): DockerImageReferenceParts {
  const firstSlashIndex = imageRef.indexOf("/");
  if (firstSlashIndex <= 0) {
    throw new Error(`Docker image reference '${imageRef}' is missing a registry host.`);
  }

  const registryHost = imageRef.slice(0, firstSlashIndex);
  if (!isExplicitRegistryHost(registryHost)) {
    throw new Error(`Docker image reference '${imageRef}' is missing a registry host.`);
  }

  const repositoryAndTag = imageRef.slice(firstSlashIndex + 1);
  const lastSlashIndex = repositoryAndTag.lastIndexOf("/");
  const tagSeparatorIndex = repositoryAndTag.lastIndexOf(":");
  if (tagSeparatorIndex <= lastSlashIndex + 1) {
    throw new Error(`Docker image reference '${imageRef}' must include a tag.`);
  }

  const repository = repositoryAndTag.slice(0, tagSeparatorIndex);
  const tag = repositoryAndTag.slice(tagSeparatorIndex + 1);
  if (repository.length === 0 || tag.length === 0) {
    throw new Error(`Docker image reference '${imageRef}' must include a repository and tag.`);
  }

  return {
    registryHost,
    repository,
    tag,
  };
}

function isExplicitRegistryHost(value: string): boolean {
  return value === "localhost" || value.includes(".") || value.includes(":");
}

export function createDockerRegistryManifest(input: {
  config: DockerRegistryDescriptor;
  layers: DockerRegistryDescriptor[];
}): DockerRegistryManifest {
  return {
    schemaVersion: 2,
    mediaType: DockerDistributionManifestMediaType,
    config: input.config,
    layers: input.layers,
  };
}

async function readDockerSaveManifestEntry(
  workspacePath: string,
  sourceImageRef: string,
): Promise<DockerSaveManifestEntry> {
  const manifestJson = await readFile(join(workspacePath, "manifest.json"), "utf8");
  const manifest: unknown = JSON.parse(manifestJson);
  if (!Array.isArray(manifest)) {
    throw new Error("docker save manifest.json must contain an array.");
  }

  const entries = manifest.map(parseDockerSaveManifestEntry);
  const matchingEntry =
    entries.find((entry) => entry.RepoTags?.includes(sourceImageRef) === true) ?? entries[0];
  if (matchingEntry === undefined) {
    throw new Error("docker save archive did not contain an image manifest entry.");
  }

  return matchingEntry;
}

function parseDockerSaveManifestEntry(value: unknown): DockerSaveManifestEntry {
  if (!isRecord(value)) {
    throw new Error("docker save manifest entry must be an object.");
  }

  const config = value["Config"];
  const layers = value["Layers"];
  const repoTags = value["RepoTags"];
  if (typeof config !== "string" || config.length === 0) {
    throw new Error("docker save manifest entry is missing Config.");
  }
  if (!Array.isArray(layers) || !layers.every((layer) => typeof layer === "string")) {
    throw new Error("docker save manifest entry is missing Layers.");
  }
  if (
    repoTags !== undefined &&
    (!Array.isArray(repoTags) || !repoTags.every((repoTag) => typeof repoTag === "string"))
  ) {
    throw new Error("docker save manifest entry has invalid RepoTags.");
  }

  return {
    Config: config,
    Layers: layers,
    ...(repoTags === undefined ? {} : { RepoTags: repoTags }),
  };
}

async function createFileDescriptor(
  filePath: string,
  mediaType: string,
): Promise<DockerRegistryDescriptor> {
  const [digest, metadata] = await Promise.all([sha256FileDigest(filePath), stat(filePath)]);

  return {
    mediaType,
    digest,
    size: metadata.size,
  };
}

async function sha256FileDigest(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return `sha256:${hash.digest("hex")}`;
}

async function uploadRegistryBlob(input: {
  baseUrl: URL;
  repository: string;
  descriptor: DockerRegistryDescriptor;
  filePath: string;
}): Promise<void> {
  const existingBlobResponse = await fetch(
    createRegistryUrl(input.baseUrl, `/v2/${input.repository}/blobs/${input.descriptor.digest}`),
    { method: "HEAD" },
  );
  if (existingBlobResponse.ok) {
    return;
  }
  if (existingBlobResponse.status !== 404) {
    throw new Error(
      `Failed to check local registry blob ${input.descriptor.digest}. Received ${String(
        existingBlobResponse.status,
      )} ${existingBlobResponse.statusText}.`,
    );
  }

  const uploadStartResponse = await fetch(
    createRegistryUrl(input.baseUrl, `/v2/${input.repository}/blobs/uploads/`),
    { method: "POST" },
  );
  if (!uploadStartResponse.ok) {
    throw new Error(
      `Failed to start local registry blob upload for ${input.descriptor.digest}. Received ${String(
        uploadStartResponse.status,
      )} ${uploadStartResponse.statusText}.`,
    );
  }

  const uploadLocation = uploadStartResponse.headers.get("location");
  if (uploadLocation === null || uploadLocation.trim().length === 0) {
    throw new Error("Local registry blob upload response did not include a Location header.");
  }

  const uploadUrl = new URL(uploadLocation, input.baseUrl);
  uploadUrl.searchParams.set("digest", input.descriptor.digest);
  const body = await readFile(input.filePath);
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
    },
    body,
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Failed to upload local registry blob ${input.descriptor.digest}. Received ${String(
        uploadResponse.status,
      )} ${uploadResponse.statusText}.`,
    );
  }
}

async function putRegistryManifest(input: {
  baseUrl: URL;
  repository: string;
  tag: string;
  manifest: DockerRegistryManifest;
}): Promise<void> {
  const manifestResponse = await fetch(
    createRegistryUrl(input.baseUrl, `/v2/${input.repository}/manifests/${input.tag}`),
    {
      method: "PUT",
      headers: {
        "content-type": DockerDistributionManifestMediaType,
      },
      body: JSON.stringify(input.manifest),
    },
  );
  if (!manifestResponse.ok) {
    throw new Error(
      `Failed to publish local registry manifest ${input.repository}:${input.tag}. Received ${String(
        manifestResponse.status,
      )} ${manifestResponse.statusText}.`,
    );
  }
}

function createRegistryUrl(baseUrl: URL, path: string): URL {
  return new URL(path, baseUrl);
}

function runCommandOrThrow(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    const failureStatus =
      result.status === null ? `signal ${String(result.signal)}` : result.status;
    throw new Error(`Command failed (${command} ${args.join(" ")}), exit code ${failureStatus}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
