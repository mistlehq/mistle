import { describe, expect, it } from "vitest";

import {
  SandboxPersistentStorageLayout,
  SandboxStorageBackend,
  type SandboxDockerVolumeStartStoragePreparation,
} from "../../types.js";
import {
  createDockerVolumeInitCommand,
  createDockerVolumeInitMounts,
  createDockerVolumeSubpathMounts,
} from "./storage.js";

function createStoragePreparation(): SandboxDockerVolumeStartStoragePreparation {
  return {
    backend: SandboxStorageBackend.DOCKER_VOLUME,
    handle: "vol-0123456789abcdef",
    layout: SandboxPersistentStorageLayout,
  };
}

describe("createDockerVolumeInitCommand", () => {
  it("creates all required persistent layout directories inside the mounted volume", () => {
    const command = createDockerVolumeInitCommand({
      storage: createStoragePreparation(),
    });

    expect(command).toContain("set -eu");
    expect(command).toContain("mkdir -p");
    expect(command).toContain("'/mnt/mistle/storage/root'");
    expect(command).toContain("'/mnt/mistle/storage/etc/codex'");
    expect(command).not.toContain("/usr/local/bin");
  });
});

describe("createDockerVolumeInitMounts", () => {
  it("mounts the named volume at the fixed initialization target", () => {
    const mounts = createDockerVolumeInitMounts({
      storage: createStoragePreparation(),
    });

    expect(mounts).toEqual([
      {
        Type: "volume",
        Source: "vol-0123456789abcdef",
        Target: "/mnt/mistle/storage",
      },
    ]);
  });
});

describe("createDockerVolumeSubpathMounts", () => {
  it("creates one volume-subpath mount per persistent layout binding", () => {
    const mounts = createDockerVolumeSubpathMounts({
      storage: createStoragePreparation(),
    });

    expect(mounts).toEqual([
      {
        Type: "volume",
        Source: "vol-0123456789abcdef",
        Target: "/root",
        VolumeOptions: {
          NoCopy: false,
          Labels: {},
          DriverConfig: {
            Name: "local",
            Options: {},
          },
          Subpath: "root",
        },
      },
      {
        Type: "volume",
        Source: "vol-0123456789abcdef",
        Target: "/etc/codex",
        VolumeOptions: {
          NoCopy: false,
          Labels: {},
          DriverConfig: {
            Name: "local",
            Options: {},
          },
          Subpath: "etc/codex",
        },
      },
    ]);
  });
});
