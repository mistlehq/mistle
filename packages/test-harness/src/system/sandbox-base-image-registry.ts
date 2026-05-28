import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

import { GenericContainer } from "testcontainers";

import type { TestServiceRuntime } from "../environment/types.js";
import { DefaultSandboxBaseImageBuild } from "./prepared-runtime.js";
import { readSystemTestSandboxBaseImageRegistryStorageDir } from "./system-test-sandbox-base-image-source.js";

const execFileAsync = promisify(execFile);

const RegistryImageReference = "registry:3";
const RegistryInternalPort = 5000;
const RegistryStorageContainerPath = "/var/lib/registry";
const SandboxBaseImageRegistryTag = "dev";

export async function startSandboxBaseImageRegistry(input: {
  sourceImageRef: string;
  pullSourceImage: boolean;
  timings: Map<string, number>;
  env?: NodeJS.ProcessEnv;
}): Promise<TestServiceRuntime & { stop: () => Promise<void> }> {
  const storageHostPath = readSystemTestSandboxBaseImageRegistryStorageDir(
    input.env ?? process.env,
  );

  const registryContainer = await measure(input.timings, "start-registry-container", async () => {
    let registryContainerDefinition = new GenericContainer(RegistryImageReference)
      .withEnvironment({
        REGISTRY_STORAGE_DELETE_ENABLED: "true",
      })
      .withExposedPorts(RegistryInternalPort);

    if (storageHostPath !== undefined) {
      await mkdir(storageHostPath, {
        recursive: true,
      });
      registryContainerDefinition = registryContainerDefinition.withBindMounts([
        {
          source: storageHostPath,
          target: RegistryStorageContainerPath,
          mode: "rw",
        },
      ]);
    }

    return registryContainerDefinition.start();
  });
  const registryAuthority = `${registryContainer.getHost()}:${String(
    registryContainer.getMappedPort(RegistryInternalPort),
  )}`;
  const sandboxBaseImageRef = `${registryAuthority}/${DefaultSandboxBaseImageBuild.repositoryPath}:${SandboxBaseImageRegistryTag}`;
  const hasCachedRegistryImage = await measure(input.timings, "check-registry-image-cache", () =>
    readRegistryImageManifestExists({
      registryBaseUrl: `http://${registryAuthority}`,
      repositoryPath: DefaultSandboxBaseImageBuild.repositoryPath,
      tag: SandboxBaseImageRegistryTag,
    }),
  );

  if (hasCachedRegistryImage) {
    input.timings.set("registry-image-cache-hit", 0);
  } else {
    input.timings.set("registry-image-cache-miss", 0);

    if (input.pullSourceImage) {
      await measure(input.timings, "pull-source-image", async () =>
        execFileAsync("docker", ["pull", input.sourceImageRef]),
      );
    }
    await measure(input.timings, "tag-source-image", async () =>
      execFileAsync("docker", ["tag", input.sourceImageRef, sandboxBaseImageRef]),
    );
    await measure(input.timings, "push-registry-image", async () =>
      execFileAsync("docker", ["push", sandboxBaseImageRef]),
    );
  }

  return {
    endpoints: {
      http: {
        hostBaseUrl: `http://${registryAuthority}`,
      },
    },
    containerId: registryContainer.getId(),
    stop: async () => {
      await registryContainer.stop({
        remove: true,
        removeVolumes: true,
        timeout: 0,
      });
    },
  };
}

export async function readRegistryImageManifestExists(input: {
  registryBaseUrl: string;
  repositoryPath: string;
  tag: string;
}): Promise<boolean> {
  const manifestUrl = new URL(
    `/v2/${input.repositoryPath}/manifests/${input.tag}`,
    input.registryBaseUrl,
  );
  const response = await fetch(manifestUrl, {
    method: "HEAD",
    headers: {
      Accept: [
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
      ].join(", "),
    },
  });

  if (response.status === 200) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }

  throw new Error(
    `Sandbox base image registry manifest check failed with status ${String(response.status)}.`,
  );
}

async function measure<T>(
  timings: Map<string, number>,
  label: string,
  callback: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await callback();
  } finally {
    timings.set(label, Date.now() - startedAt);
  }
}
