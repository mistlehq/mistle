import type Docker from "dockerode";

import {
  SandboxStorageBackend,
  type SandboxDockerVolumeStartStoragePreparation,
} from "../../types.js";

const DockerVolumeInitTargetPath = "/mnt/mistle/storage";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function createDockerVolumeInitCommand(input: {
  storage: SandboxDockerVolumeStartStoragePreparation;
}): string {
  if (input.storage.backend !== SandboxStorageBackend.DOCKER_VOLUME) {
    throw new Error("Expected Docker volume storage preparation.");
  }

  const directories = input.storage.layout.bindings.map(
    (binding) => `${DockerVolumeInitTargetPath}/${binding.sourcePath}`,
  );

  return [
    "set -eu",
    `mkdir -p ${directories.map((directory) => quoteShell(directory)).join(" ")}`,
  ].join("\n");
}

export function createDockerVolumeInitMounts(input: {
  storage: SandboxDockerVolumeStartStoragePreparation;
}): Docker.MountSettings[] {
  if (input.storage.backend !== SandboxStorageBackend.DOCKER_VOLUME) {
    throw new Error("Expected Docker volume storage preparation.");
  }

  return [
    {
      Type: "volume",
      Source: input.storage.handle,
      Target: DockerVolumeInitTargetPath,
    },
  ];
}

export function createDockerVolumeSubpathMounts(input: {
  storage: SandboxDockerVolumeStartStoragePreparation;
}): Docker.MountSettings[] {
  if (input.storage.backend !== SandboxStorageBackend.DOCKER_VOLUME) {
    throw new Error("Expected Docker volume storage preparation.");
  }

  return input.storage.layout.bindings.map((binding) => ({
    Type: "volume",
    Source: input.storage.handle,
    Target: binding.targetPath,
    VolumeOptions: {
      NoCopy: false,
      Labels: {},
      DriverConfig: {
        Name: "local",
        Options: {},
      },
      Subpath: binding.sourcePath,
    },
  }));
}
