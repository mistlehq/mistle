import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider, type SandboxImageHandle } from "../../types.js";
import {
  createOpenComputerBaseImage,
  createOpenComputerImageManifest,
} from "./image-definition.js";
import {
  OpenComputerImageHandleKinds,
  OpenComputerImageManifestSchema,
  type OpenComputerImageManifest,
  type OpenComputerStartImage,
  type ValidatedOpenComputerSandboxConfig,
} from "./schemas.js";

const OpenComputerBaseImageNamePrefix = "mistle";
const OpenComputerSha256DigestPrefix = "@sha256:";
const OpenComputerBaseImageDigestLength = 24;
const OpenComputerBaseImageManifestDigestLength = 12;
const OpenComputerDeferredImageManifestSeparator = "#";

export function createOpenComputerDeferredImageHandle(input: {
  readonly imageName: string;
  readonly manifest: OpenComputerImageManifest;
}): SandboxImageHandle {
  return createOpenComputerImageHandle(
    OpenComputerImageHandleKinds.IMAGE,
    createOpenComputerDeferredImageId(input),
  );
}

export function createOpenComputerSnapshotImageHandle(snapshotName: string): SandboxImageHandle {
  return createOpenComputerImageHandle(OpenComputerImageHandleKinds.SNAPSHOT, snapshotName);
}

export function createOpenComputerCheckpointImageHandle(checkpointId: string): SandboxImageHandle {
  return createOpenComputerImageHandle(OpenComputerImageHandleKinds.CHECKPOINT, checkpointId);
}

export function createOpenComputerTemplateImageHandle(templateId: string): SandboxImageHandle {
  return createOpenComputerImageHandle(OpenComputerImageHandleKinds.TEMPLATE, templateId);
}

export function parseOpenComputerImageHandle(handle: SandboxImageHandle): OpenComputerStartImage {
  if (handle.provider !== SandboxProvider.OPENCOMPUTER) {
    throw new SandboxConfigurationError(
      `Expected OpenComputer image handle, received provider '${handle.provider}'.`,
    );
  }

  const separatorIndex = handle.imageId.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === handle.imageId.length - 1) {
    throw new SandboxConfigurationError(
      "OpenComputer image handle must include a provider image kind prefix.",
    );
  }

  const kind = handle.imageId.slice(0, separatorIndex);
  const rawId = requireNonEmptyOpenComputerImageId(handle.imageId.slice(separatorIndex + 1));

  if (kind === OpenComputerImageHandleKinds.IMAGE) {
    return parseOpenComputerDeferredImageId(rawId);
  }

  if (kind === OpenComputerImageHandleKinds.SNAPSHOT) {
    return { kind, id: rawId };
  }

  if (kind === OpenComputerImageHandleKinds.CHECKPOINT) {
    return { kind, id: rawId };
  }

  if (kind === OpenComputerImageHandleKinds.TEMPLATE) {
    return { kind, id: rawId };
  }

  throw new SandboxConfigurationError(`Unsupported OpenComputer image handle kind "${kind}".`);
}

export function resolveOpenComputerStartImage(
  handle: SandboxImageHandle,
  input?: {
    readonly sandboxd?: ValidatedOpenComputerSandboxConfig["sandboxd"];
  },
): OpenComputerStartImage {
  if (handle.provider !== SandboxProvider.OPENCOMPUTER) {
    throw new SandboxConfigurationError(
      `Expected OpenComputer image handle, received provider '${handle.provider}'.`,
    );
  }

  if (hasOpenComputerImageKindPrefix(handle.imageId)) {
    return parseOpenComputerImageHandle(handle);
  }

  if (isOciImageRef(handle.imageId)) {
    const image = createOpenComputerBaseImage({
      source: { kind: "image", imageId: handle.imageId },
      ...(input?.sandboxd === undefined ? {} : { sandboxd: input.sandboxd }),
    });
    const manifest = createOpenComputerImageManifest(image);
    return {
      kind: OpenComputerImageHandleKinds.IMAGE,
      id: createOpenComputerBaseImageName({
        baseImageRef: handle.imageId,
        manifest,
      }),
      manifest,
    };
  }

  return parseOpenComputerImageHandle(handle);
}

export function createOpenComputerBaseImageName(input: {
  readonly baseImageRef: string;
  readonly manifest?: OpenComputerImageManifest;
}): string {
  return [
    OpenComputerBaseImageNamePrefix,
    createOpenComputerBaseImageNameDigest(input.baseImageRef),
    ...(input.manifest === undefined
      ? []
      : [createOpenComputerImageManifestNameDigest(input.manifest)]),
  ].join("-");
}

function createOpenComputerImageHandle(
  kind: OpenComputerStartImage["kind"],
  id: string,
): SandboxImageHandle {
  return {
    provider: SandboxProvider.OPENCOMPUTER,
    imageId: `${kind}:${requireNonEmptyOpenComputerImageId(id)}`,
    createdAt: new Date().toISOString(),
  };
}

function createOpenComputerDeferredImageId(input: {
  readonly imageName: string;
  readonly manifest: OpenComputerImageManifest;
}): string {
  return [
    requireNonEmptyOpenComputerImageId(input.imageName),
    encodeOpenComputerImageManifest(input.manifest),
  ].join(OpenComputerDeferredImageManifestSeparator);
}

function parseOpenComputerDeferredImageId(rawId: string): OpenComputerStartImage {
  const separatorIndex = rawId.indexOf(OpenComputerDeferredImageManifestSeparator);
  if (separatorIndex <= 0 || separatorIndex === rawId.length - 1) {
    throw new SandboxConfigurationError(
      "OpenComputer deferred image handle must include an image manifest.",
    );
  }

  const id = requireNonEmptyOpenComputerImageId(rawId.slice(0, separatorIndex));
  const manifest = decodeOpenComputerImageManifest(rawId.slice(separatorIndex + 1));
  return {
    kind: OpenComputerImageHandleKinds.IMAGE,
    id,
    manifest,
  };
}

function requireNonEmptyOpenComputerImageId(imageId: string): string {
  const normalizedImageId = imageId.trim();
  if (normalizedImageId.length === 0) {
    throw new SandboxConfigurationError("OpenComputer image handle id is required.");
  }
  return normalizedImageId;
}

function isOciImageRef(imageId: string): boolean {
  return imageId.trim().includes("/");
}

function hasOpenComputerImageKindPrefix(imageId: string): boolean {
  const normalizedImageId = imageId.trim();
  return (
    normalizedImageId.startsWith(`${OpenComputerImageHandleKinds.IMAGE}:`) ||
    normalizedImageId.startsWith(`${OpenComputerImageHandleKinds.SNAPSHOT}:`) ||
    normalizedImageId.startsWith(`${OpenComputerImageHandleKinds.CHECKPOINT}:`) ||
    normalizedImageId.startsWith(`${OpenComputerImageHandleKinds.TEMPLATE}:`)
  );
}

function createOpenComputerBaseImageNameDigest(baseImageRef: string): string {
  const normalizedBaseImageRef = requireNonEmptyOpenComputerImageId(baseImageRef);
  const digestIndex = normalizedBaseImageRef.indexOf(OpenComputerSha256DigestPrefix);
  if (digestIndex >= 0) {
    const digest = normalizedBaseImageRef.slice(
      digestIndex + OpenComputerSha256DigestPrefix.length,
    );
    if (/^[a-f0-9]{64}$/u.test(digest)) {
      return digest.slice(0, OpenComputerBaseImageDigestLength);
    }
  }

  return createHash("sha256")
    .update(normalizedBaseImageRef)
    .digest("hex")
    .slice(0, OpenComputerBaseImageDigestLength);
}

function createOpenComputerImageManifestNameDigest(manifest: OpenComputerImageManifest): string {
  return createHash("sha256")
    .update(stableStringify(OpenComputerImageManifestSchema.parse(manifest)))
    .digest("hex")
    .slice(0, OpenComputerBaseImageManifestDigestLength);
}

function encodeOpenComputerImageManifest(manifest: OpenComputerImageManifest): string {
  return Buffer.from(JSON.stringify(OpenComputerImageManifestSchema.parse(manifest))).toString(
    "base64url",
  );
}

function decodeOpenComputerImageManifest(encodedManifest: string): OpenComputerImageManifest {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encodedManifest, "base64url").toString("utf8"));
  } catch {
    throw new SandboxConfigurationError("OpenComputer deferred image manifest is invalid.");
  }

  return OpenComputerImageManifestSchema.parse(decoded);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
    );
  }

  return value;
}
